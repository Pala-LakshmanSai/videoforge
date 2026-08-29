import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { canonicalizeJson } from "@videoforge/contracts";
import { canonicalSha256 } from "@videoforge/control-plane";

import {
  V213_BRIDGE_ENVIRONMENT,
  V213_CLEANUP_RECEIPT_ENVIRONMENT,
  V213_OPERATOR_EVIDENCE_ENVIRONMENT,
  V213_RELEASE_CERTIFICATION_ENVIRONMENT,
  V213_FULL_LIVE_COMMANDS,
  V213FullLiveBridgeError,
  createV213CleanupRuntime,
  createV213EarlyCleanupRuntime,
  createV213FullLiveProductionRuntime,
  createV213PrequalificationRuntime,
  createV213ProductionRuntime,
  createV213WorkflowHttpBinding,
  executeV213FullLiveCommand,
  loadV213ResolvedRenderManifest,
  readV213CleanupProtectedInputs,
  readV213CleanupReceiptProtectedInputs,
  readV213EarlyCleanupProtectedInputs,
  readV213PrequalificationProtectedInputs,
  readV213ProtectedInputs,
  readV213ReleaseCertificationProtectedInputs,
  readV213OperatorEvidenceProtectedInputs,
  redactV213Output,
  resolveV213V209EvidenceAfterScheduling,
  runV213FullLiveCli,
  runV213CleanupReceiptCli,
  runV213OperatorEvidenceIngestionCli,
  runV213ReleaseCertificationCli,
  summarizeV213EndpointRestoration,
  V213_SERVERLESS_FLEX_RATE_SOURCE,
  createV213V209ProductionTerminalOutputResolver,
  verifyV213WorkflowOperatorRouteSource,
  type V213FullLiveBridgeRuntime,
  type V213FullLiveCommand,
  type V213FullLiveCommandHandler,
  type V213FullLiveCommandRequest,
} from "./v213-full-live-cli.js";
import { v213EvidenceKeyId } from "../hosted/v213-live-production-adapters.js";
import { V213_QUALIFICATION_CASE_DESCRIPTORS } from "./v213-dual-lane-live.js";

const HASH = `sha256:${"a".repeat(64)}` as const;

describe("V2-13 resolved render manifest reader", () => {
  const document = Object.freeze({
    schema_version: "resolved-render-manifest/v1",
    project_id: "33333333-3333-4333-8333-333333333333",
  });
  const documentSha256 = canonicalSha256(document);
  const reference = Object.freeze({
    fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
    operationId: "v2-09-short-hosted-project" as const,
    outerStateSha256: canonicalSha256({ outer: true }),
    materializationRequestSha256: canonicalSha256({ materialization: true }),
    accountId: "22222222-2222-4222-8222-222222222222",
    workspaceId: "44444444-4444-4444-8444-444444444444",
    projectId: "33333333-3333-4333-8333-333333333333",
    projectRevisionId: "55555555-5555-4555-8555-555555555555",
    artifactUri: `vf-local://objects/sha256/${documentSha256.slice(7, 9)}/${documentSha256.slice(7)}.json`,
    sha256: documentSha256,
    issuedAt: "2026-08-28T00:00:00.000Z",
    nonce: "manifest-read-nonce-000000000001",
  });

  it("sends exact bearer/HMAC bindings and revalidates the returned document", async () => {
    const bearer = "worker-operator-bearer-at-least-32-bytes";
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        "https://production.example/api/operator/v2-13/resolved-render-manifest",
      );
      const raw = String(init?.body);
      expect(init?.headers).toMatchObject({
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(raw)),
        "x-videoforge-signature": createHmac("sha256", bearer).update(raw).digest("hex"),
      });
      const request = JSON.parse(raw) as Record<string, unknown>;
      const { requestSha256, ...unsigned } = request;
      expect(requestSha256).toBe(canonicalSha256(unsigned));
      return Response.json({
        schemaVersion: "videoforge.v213-resolved-render-manifest-read-result/v1",
        fullLiveAuthorityId: reference.fullLiveAuthorityId,
        operationId: reference.operationId,
        outerStateSha256: reference.outerStateSha256,
        materializationRequestSha256: reference.materializationRequestSha256,
        accountId: reference.accountId,
        workspaceId: reference.workspaceId,
        projectId: reference.projectId,
        projectRevisionId: reference.projectRevisionId,
        sha256: reference.sha256,
        requestSha256,
        document,
      });
    });
    await expect(
      loadV213ResolvedRenderManifest({
        workerOrigin: "https://production.example",
        workerOperatorBearer: bearer,
        reference,
        fetch,
      }),
    ).resolves.toEqual(document);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a response identity drift without returning the document", async () => {
    await expect(
      loadV213ResolvedRenderManifest({
        workerOrigin: "https://production.example",
        workerOperatorBearer: "worker-operator-bearer-at-least-32-bytes",
        reference,
        fetch: vi.fn(async (_input, init) => {
          const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return Response.json({
            schemaVersion: "videoforge.v213-resolved-render-manifest-read-result/v1",
            fullLiveAuthorityId: reference.fullLiveAuthorityId,
            operationId: "v2-12-long-output",
            outerStateSha256: reference.outerStateSha256,
            materializationRequestSha256: reference.materializationRequestSha256,
            accountId: reference.accountId,
            workspaceId: reference.workspaceId,
            projectId: reference.projectId,
            projectRevisionId: reference.projectRevisionId,
            sha256: reference.sha256,
            requestSha256: request.requestSha256,
            document,
          });
        }),
      }),
    ).rejects.toThrow("JIT_RENDER_PLAN_PRIVATE_READER_DRIFT");
  });
});

function request(command: V213FullLiveCommand): V213FullLiveCommandRequest {
  return {
    schemaVersion: "videoforge.v213-full-live-command/v1",
    commandId: `command:${command}`,
    stageAuthorityId: "stage:production:one",
    command,
    input: { exact: true },
  };
}

function qualificationStaticBindings() {
  const protectedInput = (
    path: string,
    character: string,
    contentType: "image/png" | "audio/wav",
  ) => ({ path, sha256: `sha256:${character.repeat(64)}`, sizeBytes: 100, contentType });
  return {
    qualificationGeneratorSha256: `sha256:${"1".repeat(64)}`,
    qualificationCaseDescriptors: V213_QUALIFICATION_CASE_DESCRIPTORS,
    qualificationSourceRefs: {
      caseSource: {
        path: "apps/web/src/server/providers/v213-dual-lane-live.ts",
        sha256: `sha256:${"2".repeat(64)}`,
      },
      generators: {
        mage: {
          path: "deploy/v2-13/generate-mage-qualification-case.mjs",
          sha256: `sha256:${"3".repeat(64)}`,
        },
        soulx: {
          path: "deploy/v2-13/generate-soulx-qualification-cases.mjs",
          sha256: `sha256:${"4".repeat(64)}`,
        },
      },
      validators: {
        mage: {
          path: "workers/image-media/src/videoforge_image_media/mage_production.py",
          sha256: `sha256:${"5".repeat(64)}`,
        },
        soulx: {
          path: "workers/avatar-primary/soulx_serverless.py",
          sha256: `sha256:${"6".repeat(64)}`,
        },
      },
    },
    qualificationProtectedInputDescriptors: {
      avatarSource: protectedInput(".videoforge/private/avatar.png", "7", "image/png"),
      soulx2s: protectedInput(".videoforge/private/audio-2s.wav", "8", "audio/wav"),
      soulx4s: protectedInput(".videoforge/private/audio-4s.wav", "9", "audio/wav"),
      soulx6s: protectedInput(".videoforge/private/audio-6s.wav", "a", "audio/wav"),
      soulx10s: protectedInput(".videoforge/private/audio-10s.wav", "b", "audio/wav"),
    },
    qualificationR2: {
      accountId: "c".repeat(32),
      bucketName: "videoforge-private",
    },
  } as const;
}

function prequalificationRequest(): V213FullLiveCommandRequest {
  const lane = (name: "mage" | "soulx", suffix: string) => ({
    lane: name,
    volumeIdSha256: `sha256:${suffix.repeat(64)}`,
    volumeManifestSha256: `sha256:${suffix === "b" ? "c".repeat(64) : "d".repeat(64)}`,
  });
  return {
    ...request("fresh-live-preflight"),
    input: {
      schemaVersion: "videoforge.v213-full-live-prequalification-input/v1",
      outerStateSha256: HASH,
      fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      dualLaneInput: {
        accountIdSha256: HASH,
        mage: lane("mage", "b"),
        soulx: lane("soulx", "e"),
        totalCapUsd: 17.5,
        mageQualificationCapUsd: 4.5,
        soulxQualificationCapUsd: 1,
        qualificationEnvelopeSchemaSha256: `sha256:${"f".repeat(64)}`,
        envelopeSigningKeyId: "pair-envelope-key-1",
        ...qualificationStaticBindings(),
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

describe("V2-09 temporal evidence boundary", () => {
  const signingKey = new Uint8Array(32).fill(7);
  const request = {
    accountId: "account-1",
    workspaceId: "workspace-1",
    generationRequestId: "generation-1",
    deadlineAt: "2026-08-26T00:10:00.000Z",
  } as const;
  const terminalProof = {
    schemaVersion: "videoforge.v2-09-terminal-output-proof/v1",
    workflowId: "hosted-pair-generation-1",
    accountId: request.accountId,
    workspaceId: request.workspaceId,
    generationRequestId: request.generationRequestId,
    terminal: true,
    readbackVerified: true,
    finalOutputSha256: HASH,
    finalOutputReceiptSha256: HASH,
    terminalAt: "2026-08-26T00:05:00.000Z",
  } as const;

  const writeReceipt = (
    paths: { readonly receiptPath: string; readonly request: Readonly<Record<string, unknown>> },
    overrides: Readonly<Record<string, unknown>> = {},
  ) => {
    const document = {
      schemaVersion: "videoforge.v2-09-real-chrome-acceptance/v1",
      accountId: paths.request.accountId,
      workspaceId: paths.request.workspaceId,
      generationRequestId: paths.request.generationRequestId,
      workflowId: paths.request.workflowId,
      finalOutputSha256: paths.request.finalOutputSha256,
      finalOutputReceiptSha256: paths.request.finalOutputReceiptSha256,
      terminalAt: paths.request.terminalAt,
      browser: "REAL_CHROME",
      playbackAccepted: true,
      downloadAccepted: true,
      durationSeconds: 30,
      observedAt: paths.request.terminalAt,
      ...overrides,
    };
    const artifactSha256 = `sha256:${createHash("sha256")
      .update(canonicalizeJson(document as never), "utf8")
      .digest("hex")}`;
    writeFileSync(
      paths.receiptPath,
      canonicalizeJson({
        schemaVersion: "videoforge.v2-09-real-chrome-receipt/v1",
        kind: "CHROME",
        requestSha256: paths.request.requestSha256,
        artifactSha256,
        keyId: v213EvidenceKeyId(signingKey),
        signatureHex: createHmac("sha256", signingKey)
          .update(`CHROME\n${artifactSha256}\n${artifactSha256}`, "utf8")
          .digest("hex"),
        document,
      } as never),
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    chmodSync(paths.receiptPath, 0o600);
  };

  it("schedules exactly once before asking for post-terminal Chrome evidence", async () => {
    let scheduled = false;
    const schedule = vi.fn(async () => {
      scheduled = true;
      return { id: "hosted-pair-generation-1" };
    });
    const resolver = vi.fn(async (value) => {
      expect(scheduled).toBe(true);
      expect(value.workflowId).toBe("hosted-pair-generation-1");
      return terminalProof;
    });
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-test-"));
    chmodSync(directory, 0o700);

    try {
      await expect(
        resolveV213V209EvidenceAfterScheduling({
          schedule,
          resolver,
          request,
          evidenceSigningKey: signingKey,
          exchangeDirectory: directory,
          now: () => new Date("2026-08-26T00:06:00.000Z"),
          onRequestWritten: writeReceipt,
        }),
      ).resolves.toMatchObject({
        scheduled: { id: "hosted-pair-generation-1" },
        evidence: {
          chromeEvidenceSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
          finalOutputSha256: HASH,
          finalOutputReceiptSha256: HASH,
        },
      });
      expect(schedule).toHaveBeenCalledOnce();
      expect(resolver).toHaveBeenCalledOnce();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an expired deadline before scheduling when the production evidence adapter is absent", async () => {
    const schedule = vi.fn(async () => ({ id: "hosted-pair-generation-1" }));

    await expect(
      resolveV213V209EvidenceAfterScheduling({ schedule, request }),
    ).rejects.toMatchObject({
      code: "V209_CHROME_RECEIPT_DEADLINE_EXCEEDED",
    });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("aborts a hung schedule before resolving terminal evidence", async () => {
    const deadlineAt = new Date(Date.now() + 30).toISOString();
    let scheduleSignal: AbortSignal | undefined;
    const schedule = vi.fn((options?: { readonly signal?: AbortSignal }) => {
      scheduleSignal = options?.signal;
      return new Promise<never>(() => undefined);
    });
    const resolver = vi.fn(async () => terminalProof);

    await expect(
      resolveV213V209EvidenceAfterScheduling({
        schedule,
        resolver,
        request: { ...request, deadlineAt },
        evidenceSigningKey: signingKey,
      }),
    ).rejects.toMatchObject({ code: "V209_CHROME_RECEIPT_DEADLINE_EXCEEDED" });
    expect(schedule).toHaveBeenCalledOnce();
    expect(scheduleSignal?.aborted).toBe(true);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("aborts a hung terminal resolver at the same absolute deadline", async () => {
    const deadlineAt = new Date(Date.now() + 30).toISOString();
    let resolverSignal: AbortSignal | undefined;
    const schedule = vi.fn(async () => ({ id: terminalProof.workflowId }));
    const resolver = vi.fn(
      async (_request: unknown, options?: { readonly signal?: AbortSignal }) => {
        resolverSignal = options?.signal;
        return new Promise<never>(() => undefined);
      },
    );

    await expect(
      resolveV213V209EvidenceAfterScheduling({
        schedule,
        resolver,
        request: { ...request, deadlineAt },
        evidenceSigningKey: signingKey,
      }),
    ).rejects.toMatchObject({ code: "V209_CHROME_RECEIPT_DEADLINE_EXCEEDED" });
    expect(schedule).toHaveBeenCalledOnce();
    expect(resolver).toHaveBeenCalledOnce();
    expect(resolverSignal?.aborted).toBe(true);
  });

  it("aborts a hung post-terminal operator handoff before receipt polling", async () => {
    const deadlineAt = new Date(Date.now() + 30).toISOString();
    let handoffSignal: AbortSignal | undefined;
    const schedule = vi.fn(async () => ({ id: terminalProof.workflowId }));
    const resolver = vi.fn(async () => terminalProof);
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-handoff-deadline-"));
    chmodSync(directory, 0o700);
    try {
      await expect(
        resolveV213V209EvidenceAfterScheduling({
          schedule,
          resolver,
          request: { ...request, deadlineAt },
          evidenceSigningKey: signingKey,
          exchangeDirectory: directory,
          onRequestWritten: (paths) => {
            handoffSignal = paths.signal;
            return new Promise<void>(() => undefined);
          },
        }),
      ).rejects.toMatchObject({ code: "V209_CHROME_RECEIPT_DEADLINE_EXCEEDED" });
      expect(handoffSignal?.aborted).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a receipt that becomes available exactly at the deadline", async () => {
    const deadlineAt = "2026-08-26T00:07:00.000Z";
    let currentMs = Date.parse("2026-08-26T00:06:00.000Z");
    const schedule = vi.fn(async () => ({ id: terminalProof.workflowId }));
    const resolver = vi.fn(async () => terminalProof);
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-boundary-"));
    chmodSync(directory, 0o700);
    try {
      await expect(
        resolveV213V209EvidenceAfterScheduling({
          schedule,
          resolver,
          request: { ...request, deadlineAt },
          evidenceSigningKey: signingKey,
          exchangeDirectory: directory,
          now: () => new Date(currentMs),
          onRequestWritten: (paths) => {
            writeReceipt(paths);
            currentMs = Date.parse(deadlineAt);
          },
        }),
      ).rejects.toMatchObject({ code: "V209_CHROME_RECEIPT_DEADLINE_EXCEEDED" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("default terminal resolver waits for settled COMPLETE output and never dispatches", async () => {
    let nowMs = Date.parse("2026-08-26T00:06:00.000Z");
    let reads = 0;
    let terminalQuery = "";
    let terminalParameters: readonly unknown[] = [];
    const workflow = {
      create: vi.fn(),
      get: vi.fn(async () => ({
        id: "hosted-pair-generation-1",
        status: vi.fn(async () => "EXISTING" as const),
        sendEvent: vi.fn(async () => undefined),
      })),
    };
    const database = {
      transaction: vi.fn(async (callback) =>
        callback({
          query: vi.fn(async (sql: string, parameters?: readonly unknown[]) => {
            if (sql.includes("videoforge.account_id")) return { rows: [] };
            terminalQuery = sql;
            terminalParameters = parameters ?? [];
            reads += 1;
            return { rows: [{ value: reads === 2 ? terminalProof : null }] };
          }),
        }),
      ),
    };
    const resolver = createV213V209ProductionTerminalOutputResolver({
      workflow,
      database: database as never,
      now: () => new Date(nowMs),
      sleep: async () => {
        nowMs += 1_000;
      },
      pollIntervalMs: 100,
    });

    await expect(resolver({ ...request, workflowId: terminalProof.workflowId })).resolves.toEqual(
      terminalProof,
    );
    expect(workflow.get).toHaveBeenCalledOnce();
    expect(reads).toBe(2);
    expect(terminalQuery).toContain("videoforge_load_v209_terminal_output_projection");
    expect(terminalQuery).toContain("$1::uuid");
    expect(terminalQuery).toContain("$2::uuid");
    expect(terminalQuery).toContain("$3::uuid");
    expect(terminalQuery).toContain("$4::text");
    expect(terminalQuery).not.toContain("video_runtime_states");
    expect(terminalQuery).not.toContain("provider_workload_leases");
    expect(terminalParameters).toEqual([
      request.accountId,
      request.workspaceId,
      request.generationRequestId,
      terminalProof.workflowId,
    ]);
  });

  it("rejects a malformed database projection before Chrome exchange", async () => {
    const sendEvent = vi.fn(async () => undefined);
    const workflow = {
      create: vi.fn(),
      get: vi.fn(async () => ({
        id: terminalProof.workflowId,
        status: vi.fn(async () => "EXISTING" as const),
        sendEvent,
      })),
    };
    const database = {
      transaction: vi.fn(async (callback) =>
        callback({
          query: vi.fn(async (sql: string) =>
            sql.includes("videoforge.account_id")
              ? { rows: [] }
              : { rows: [{ value: { ...terminalProof, finalOutputSha256: "not-a-sha" } }] },
          ),
        }),
      ),
    };
    const resolver = createV213V209ProductionTerminalOutputResolver({
      workflow,
      database: database as never,
      now: () => new Date("2026-08-26T00:06:00.000Z"),
      sleep: async () => undefined,
      pollIntervalMs: 100,
    });

    await expect(
      resolver({ ...request, workflowId: terminalProof.workflowId }),
    ).rejects.toMatchObject({
      code: "V209_TERMINAL_OUTPUT_PROOF_INVALID",
    });
    expect(workflow.get).toHaveBeenCalledOnce();
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it("default terminal resolver times out without a terminal/output proof", async () => {
    let nowMs = Date.parse("2026-08-26T00:00:00.000Z");
    const workflow = {
      create: vi.fn(),
      get: vi.fn(async () => ({
        id: "hosted-pair-generation-1",
        status: vi.fn(async () => "EXISTING" as const),
        sendEvent: vi.fn(async () => undefined),
      })),
    };
    const database = {
      transaction: vi.fn(async (callback) =>
        callback({
          query: vi.fn(async (sql: string) =>
            sql.includes("videoforge.account_id") ? { rows: [] } : { rows: [{ value: null }] },
          ),
        }),
      ),
    };
    const resolver = createV213V209ProductionTerminalOutputResolver({
      workflow,
      database: database as never,
      now: () => new Date(nowMs),
      sleep: async () => {
        nowMs += 1_000;
      },
      pollIntervalMs: 100,
    });
    const shortDeadline = {
      ...request,
      workflowId: terminalProof.workflowId,
      deadlineAt: "2026-08-26T00:00:02.000Z",
    };

    await expect(resolver(shortDeadline)).rejects.toMatchObject({
      code: "V209_TERMINAL_OUTPUT_DEADLINE_EXCEEDED",
    });
    expect(workflow.get).toHaveBeenCalledOnce();
  });

  it("aborts a hung workflow lookup at the absolute deadline", async () => {
    const deadlineAt = new Date(Date.now() + 30).toISOString();
    let lookupSignal: AbortSignal | undefined;
    const workflow = {
      create: vi.fn(),
      get: vi.fn((_workflowId: string, options?: { readonly signal?: AbortSignal }) => {
        lookupSignal = options?.signal;
        return new Promise<never>(() => undefined);
      }),
    };
    const database = { transaction: vi.fn() };
    const resolver = createV213V209ProductionTerminalOutputResolver({
      workflow,
      database: database as never,
      now: () => new Date(),
      sleep: vi.fn(async () => undefined),
    });

    await expect(
      resolver({ ...request, workflowId: terminalProof.workflowId, deadlineAt }),
    ).rejects.toMatchObject({ code: "V209_TERMINAL_OUTPUT_DEADLINE_EXCEEDED" });
    expect(workflow.get).toHaveBeenCalledOnce();
    expect(lookupSignal?.aborted).toBe(true);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("aborts a hung workflow status read before opening the database", async () => {
    const deadlineAt = new Date(Date.now() + 30).toISOString();
    let statusSignal: AbortSignal | undefined;
    const status = vi.fn((options?: { readonly signal?: AbortSignal }) => {
      statusSignal = options?.signal;
      return new Promise<never>(() => undefined);
    });
    const workflow = {
      create: vi.fn(),
      get: vi.fn(async () => ({
        id: terminalProof.workflowId,
        status,
        sendEvent: vi.fn(async () => undefined),
      })),
    };
    const database = { transaction: vi.fn() };
    const resolver = createV213V209ProductionTerminalOutputResolver({
      workflow,
      database: database as never,
      now: () => new Date(),
      sleep: vi.fn(async () => undefined),
    });

    await expect(
      resolver({ ...request, workflowId: terminalProof.workflowId, deadlineAt }),
    ).rejects.toMatchObject({ code: "V209_TERMINAL_OUTPUT_DEADLINE_EXCEEDED" });
    expect(status).toHaveBeenCalledOnce();
    expect(statusSignal?.aborted).toBe(true);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("aborts a hung database transaction and never polls after expiry", async () => {
    const deadlineAt = new Date(Date.now() + 30).toISOString();
    let transactionSignal: AbortSignal | undefined;
    const workflow = {
      create: vi.fn(),
      get: vi.fn(async () => ({
        id: terminalProof.workflowId,
        status: vi.fn(async () => "EXISTING" as const),
        sendEvent: vi.fn(async () => undefined),
      })),
    };
    const database = {
      transaction: vi.fn(
        (
          _callback: (transaction: never) => Promise<unknown>,
          options?: { readonly signal?: AbortSignal },
        ) => {
          transactionSignal = options?.signal;
          return new Promise<never>(() => undefined);
        },
      ),
    };
    const resolver = createV213V209ProductionTerminalOutputResolver({
      workflow,
      database: database as never,
      now: () => new Date(),
      sleep: vi.fn(async () => undefined),
    });

    await expect(
      resolver({ ...request, workflowId: terminalProof.workflowId, deadlineAt }),
    ).rejects.toMatchObject({ code: "V209_TERMINAL_OUTPUT_DEADLINE_EXCEEDED" });
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(transactionSignal?.aborted).toBe(true);
  });

  it("rejects a short deadline after status and does not start a database read", async () => {
    const nowMs = Date.now();
    const deadlineMs = nowMs + 20;
    let currentMs = nowMs;
    const status = vi.fn(async () => {
      currentMs = deadlineMs;
      return undefined;
    });
    const workflow = {
      create: vi.fn(),
      get: vi.fn(async () => ({
        id: terminalProof.workflowId,
        status,
        sendEvent: vi.fn(async () => undefined),
      })),
    };
    const database = { transaction: vi.fn() };
    const resolver = createV213V209ProductionTerminalOutputResolver({
      workflow,
      database: database as never,
      now: () => new Date(currentMs),
      sleep: vi.fn(async () => undefined),
    });

    await expect(
      resolver({
        ...request,
        workflowId: terminalProof.workflowId,
        deadlineAt: new Date(deadlineMs).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "V209_TERMINAL_OUTPUT_DEADLINE_EXCEEDED" });
    expect(workflow.get).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledOnce();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed or pre-terminal evidence without redispatch", async () => {
    const schedule = vi.fn(async () => ({ id: "hosted-pair-generation-1" }));
    const resolver = vi.fn(async () => terminalProof);
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-test-"));
    chmodSync(directory, 0o700);

    try {
      await expect(
        resolveV213V209EvidenceAfterScheduling({
          schedule,
          resolver,
          request,
          evidenceSigningKey: signingKey,
          exchangeDirectory: directory,
          now: () => new Date("2026-08-26T00:06:00.000Z"),
          onRequestWritten: (paths) =>
            writeReceipt(paths, { finalOutputSha256: HASH.replace(/a/gu, "b") }),
        }),
      ).rejects.toMatchObject({ code: "V209_CHROME_RECEIPT_INVALID" });
      expect(schedule).toHaveBeenCalledOnce();
      expect(resolver).toHaveBeenCalledOnce();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a receipt that claims a non-Chrome browser", async () => {
    const schedule = vi.fn(async () => ({ id: "hosted-pair-generation-1" }));
    const resolver = vi.fn(async () => terminalProof);
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-test-"));
    chmodSync(directory, 0o700);

    try {
      await expect(
        resolveV213V209EvidenceAfterScheduling({
          schedule,
          resolver,
          request,
          evidenceSigningKey: signingKey,
          exchangeDirectory: directory,
          now: () => new Date("2026-08-26T00:06:00.000Z"),
          onRequestWritten: (paths) => writeReceipt(paths, { browser: "CHROMIUM" }),
        }),
      ).rejects.toMatchObject({ code: "V209_CHROME_RECEIPT_INVALID" });
      expect(schedule).toHaveBeenCalledOnce();
      expect(resolver).toHaveBeenCalledOnce();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not retry scheduling when the post-terminal resolver fails", async () => {
    const schedule = vi.fn(async () => ({ id: "hosted-pair-generation-1" }));
    const resolver = vi.fn(async () => {
      throw new Error("chrome capture unavailable");
    });
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-test-"));
    chmodSync(directory, 0o700);

    try {
      await expect(
        resolveV213V209EvidenceAfterScheduling({
          schedule,
          resolver,
          request,
          evidenceSigningKey: signingKey,
          exchangeDirectory: directory,
          now: () => new Date("2026-08-26T00:06:00.000Z"),
        }),
      ).rejects.toThrow("chrome capture unavailable");
      expect(schedule).toHaveBeenCalledOnce();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed on a non-private exchange directory before receipt polling", async () => {
    const schedule = vi.fn(async () => ({ id: "hosted-pair-generation-1" }));
    const resolver = vi.fn(async () => terminalProof);
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-test-"));
    chmodSync(directory, 0o755);

    try {
      await expect(
        resolveV213V209EvidenceAfterScheduling({
          schedule,
          resolver,
          request,
          evidenceSigningKey: signingKey,
          exchangeDirectory: directory,
          now: () => new Date("2026-08-26T00:06:00.000Z"),
        }),
      ).rejects.toMatchObject({ code: "V209_CHROME_EVIDENCE_DIRECTORY_MODE_INVALID" });
      expect(schedule).toHaveBeenCalledOnce();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("V2-13 full-live TypeScript bridge", () => {
  it("binds the official Serverless Flex rate separately from the Secure Pod catalog", () => {
    expect(V213_SERVERLESS_FLEX_RATE_SOURCE).toMatchObject({
      provider: "RunPod",
      product: "SERVERLESS_FLEX",
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      billingUnit: "USD_PER_GPU_SECOND",
      rateUsdPerSecond: 0.00031,
      rateUsdPerGpuHour: 1.116,
      source: "OFFICIAL_CURRENT_RUNPOD_SERVERLESS_FLEX_PRICING_SNAPSHOT",
    });
    expect(V213_SERVERLESS_FLEX_RATE_SOURCE.rateUsdPerSecond * 3600).toBeCloseTo(
      V213_SERVERLESS_FLEX_RATE_SOURCE.rateUsdPerGpuHour,
      12,
    );
  });

  it("never reports a max-one production pair when cleanup retained zero endpoints", () => {
    expect(
      summarizeV213EndpointRestoration({
        production: [],
        productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
        productionResourcesAbsent: true,
        deletedEndpointIdSha256s: [],
        deletedTemplateIdSha256s: [],
      }),
    ).toMatchObject({
      bothEndpointsMaxWorkersOne: false,
      retainedProductionEndpoints: 0,
      productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
      productionResourcesAbsent: true,
      rollbackIdentityPinned: false,
      rollbackReadbackPassed: false,
      releaseCurrentRestored: false,
    });
  });

  it("reports the final max-one proof only for two distinct exact production lanes", () => {
    const deployment = (
      lane: "mage" | "soulx",
      endpointIdSha256: string,
      templateIdSha256: string,
      workersMax = 1,
    ) => ({
      lane,
      purpose: "production",
      endpointIdSha256,
      templateIdSha256,
      workersMin: 0,
      workersMax,
      gpuCount: 1,
      handlerConcurrency: 1,
      scalerType: "REQUEST_COUNT",
      scalerValue: 1,
    });
    const production = [
      deployment("mage", `sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`),
      deployment("soulx", `sha256:${"c".repeat(64)}`, `sha256:${"d".repeat(64)}`),
    ];
    const exact = {
      production,
      productionCleanupState: "EXACT_MAX_ONE_PAIR_RETAINED",
      productionResourcesAbsent: false,
      deletedEndpointIdSha256s: [],
      deletedTemplateIdSha256s: [],
    };
    expect(summarizeV213EndpointRestoration(exact as never)).toMatchObject({
      bothEndpointsMaxWorkersOne: true,
      retainedProductionEndpoints: 2,
      productionCleanupState: "EXACT_MAX_ONE_PAIR_RETAINED",
      productionResourcesAbsent: false,
      rollbackIdentityPinned: true,
      rollbackReadbackPassed: true,
      releaseCurrentRestored: true,
    });
    expect(() =>
      summarizeV213EndpointRestoration({
        ...exact,
        production: [
          deployment("mage", `sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`, 2),
          production[1],
        ],
      } as never),
    ).toThrowError(expect.objectContaining({ code: "CLEANUP_PRODUCTION_STATE_MISMATCH" }));
    expect(() =>
      summarizeV213EndpointRestoration({
        ...exact,
        productionCleanupState: "UNKNOWN",
      } as never),
    ).toThrowError(expect.objectContaining({ code: "CLEANUP_PRODUCTION_STATE_INVALID" }));
    expect(() =>
      summarizeV213EndpointRestoration({
        ...exact,
        productionResourcesAbsent: undefined,
      } as never),
    ).toThrowError(expect.objectContaining({ code: "CLEANUP_PRODUCTION_STATE_MISMATCH" }));
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
          executeV213: async () => ({
            summary: { evidenceSha256: HASH },
            completionSha256: HASH,
            releaseChromeOutput: {
              scope: {
                accountId: "account-id",
                workspaceId: "workspace-id",
                projectId: "project-id",
                projectRevisionId: "project-revision-id",
                attemptId: "attempt-id",
              },
              outputSha256: HASH,
              finalOutputReceiptSha256: HASH,
              smokeTerminalAt: "2026-08-28T00:00:00.000Z",
            },
          }),
        },
        evidence: { signAndStore: async () => ({ artifactSha256: HASH }) },
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

  it("runs release certification through only the DB-only child descriptor", async () => {
    const fullLiveAuthorityId = "11111111-1111-4111-8111-111111111111";
    const predecessorEvidenceSha256s = {
      "v2-13-final-two-lane-smoke": canonicalSha256({ smoke: true }),
      "restore-endpoints-max-one": canonicalSha256({ restore: true }),
      "prove-zero-workers": canonicalSha256({ zero: true }),
      "read-settled-billing": canonicalSha256({ billing: true }),
      "reconcile-exact-resources": canonicalSha256({ resources: true }),
    };
    const unsigned = {
      schemaVersion: "videoforge.v213-local-release-certification-request/v1",
      fullLiveAuthorityId,
      workId: "outer-authority:certify-v2-13-release",
      outerStateSha256: canonicalSha256({ outer: true }),
      predecessorEvidenceSha256s,
      resumed: true,
      authorizedUnsettled: true,
      reconciliationOnly: true,
      persistenceForbidden: true,
      dispatchForbidden: true,
      providerDispatchForbidden: true,
    } as const;
    const request = { ...unsigned, requestSha256: canonicalSha256(unsigned) };
    const operatorDatabaseUrl =
      "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require";
    const secrets = {
      schemaVersion: "videoforge.v213-full-live-production-secrets/v1",
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
      mageEndpointId: "mage-endpoint-1",
      soulxEndpointId: "soulx-endpoint-1",
    } as const;
    const values = new Map([
      ["20", JSON.stringify(request)],
      ["21", operatorDatabaseUrl],
      ["22", JSON.stringify(secrets)],
    ]);
    const environment = {
      [V213_RELEASE_CERTIFICATION_ENVIRONMENT.requestFd]: "20",
      [V213_RELEASE_CERTIFICATION_ENVIRONMENT.operatorDatabaseUrlFd]: "21",
      [V213_RELEASE_CERTIFICATION_ENVIRONMENT.productionSecretsFd]: "22",
    };
    const readFd = (fd: string | undefined) => values.get(fd ?? "") ?? "";
    expect(readV213ReleaseCertificationProtectedInputs(environment, readFd)).toMatchObject({
      request,
      operatorDatabaseUrl,
    });
    const result = {
      schemaVersion: "videoforge.v213-final-release-certification-result/v1",
      actualUsd: 0,
      externalSpendUsd: 0,
      gpuUse: false,
      providerMutationPerformed: false,
      currentRunEvidence: true,
      certified: true,
      releaseStatus: "release_certified",
      gateCount: 15,
      missingGateCount: 0,
      invalidGateCount: 0,
      liveReleaseAuthorized: false,
      requiresExplicitReleaseAuthority: true,
      releaseIdentitySha256: canonicalSha256({ release: true }),
      ledgerSha256: canonicalSha256({ ledger: true }),
      evidenceSha256: canonicalSha256({ ledger: true }),
      predecessorEvidenceSha256s,
    } as const;
    const certify = vi.fn(async () => result);
    const createCertifier = vi.fn(() => certify);
    const createOperatorDatabase = vi.fn(() => ({}) as never);
    let output = "";
    await runV213ReleaseCertificationCli(
      ["--certify-release", "EXECUTE_EXACT_V2_13_LOCAL_RELEASE_CERTIFICATION"],
      {
        environment,
        readFd,
        createOperatorDatabase,
        createCertifier,
        write: (value) => (output += value),
      },
    );
    expect(JSON.parse(output)).toEqual(result);
    expect(createOperatorDatabase).toHaveBeenCalledOnce();
    expect(createCertifier).toHaveBeenCalledOnce();
    const { schemaVersion, ...certificationRequest } = unsigned;
    expect(schemaVersion).toBe("videoforge.v213-local-release-certification-request/v1");
    expect(certify).toHaveBeenCalledWith(certificationRequest);
    const cancellation = new AbortController();
    let certificationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      certificationStarted = resolve;
    });
    const waitingCertifier = vi.fn(async () => {
      certificationStarted();
      return new Promise<typeof result>((resolve) => {
        cancellation.signal.addEventListener("abort", () => resolve(result), { once: true });
      });
    });
    let cancelledOutput = "";
    const pendingCertification = runV213ReleaseCertificationCli(
      ["--certify-release", "EXECUTE_EXACT_V2_13_LOCAL_RELEASE_CERTIFICATION"],
      {
        environment,
        readFd,
        createOperatorDatabase,
        createCertifier: () => waitingCertifier,
        cancellation: { signal: cancellation.signal },
        write: (value) => (cancelledOutput += value),
      },
    );
    await started;
    cancellation.abort();
    await expect(pendingCertification).rejects.toEqual(
      expect.objectContaining({ code: "CANCELLATION_REQUESTED" }),
    );
    expect(waitingCertifier).toHaveBeenCalledOnce();
    expect(cancelledOutput).toBe("");
    expect(() =>
      readV213ReleaseCertificationProtectedInputs(
        { ...environment, [V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd]: "23" },
        readFd,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "RELEASE_CERTIFICATION_AMBIENT_BINDING_REJECTED" }),
    );
  });

  it("finalizes cleanup evidence through an exact DB-only child and rejects ambient provider FDs", async () => {
    const fullLiveAuthorityId = "11111111-1111-4111-8111-111111111111";
    const summary = { zeroWorkers: true, reads: [{}, {}, {}] };
    const unsigned = {
      schemaVersion: "videoforge.v213-local-cleanup-receipt-finalization-request/v2" as const,
      fullLiveAuthorityId,
      operationId: "prove-zero-workers" as const,
      outerStateSha256: canonicalSha256({ outer: "cleanup" }),
      providerCleanupEvidenceSha256: canonicalSha256(summary),
      summary,
      readbackOnly: true,
      failureCleanup: false,
    };
    const request = { ...unsigned, requestSha256: canonicalSha256(unsigned) };
    const operatorDatabaseUrl =
      "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require";
    const evidenceSigningKeyBase64 = Buffer.alloc(32, 9).toString("base64");
    const values = new Map([
      ["30", JSON.stringify(request)],
      ["31", operatorDatabaseUrl],
      ["32", evidenceSigningKeyBase64],
    ]);
    const environment = {
      [V213_CLEANUP_RECEIPT_ENVIRONMENT.requestFd]: "30",
      [V213_CLEANUP_RECEIPT_ENVIRONMENT.operatorDatabaseUrlFd]: "31",
      [V213_CLEANUP_RECEIPT_ENVIRONMENT.evidenceSigningKeyFd]: "32",
    };
    const readFd = (fd: string | undefined) => values.get(fd ?? "") ?? "";
    expect(readV213CleanupReceiptProtectedInputs(environment, readFd)).toMatchObject({
      request,
      operatorDatabaseUrl,
    });
    const result = {
      schemaVersion: "videoforge.v213-cleanup-receipt-finalization-result/v1" as const,
      fullLiveAuthorityId,
      operationId: "prove-zero-workers" as const,
      providerCleanupEvidenceSha256: unsigned.providerCleanupEvidenceSha256,
      receiptArtifactSha256: canonicalSha256({ receipt: "cleanup" }),
      releaseFactMaterializationSha256: canonicalSha256({ materialization: "cleanup" }),
      readbackOnly: true,
    };
    const finalize = vi.fn(async () => result);
    const createFinalizer = vi.fn(() => finalize);
    const createOperatorDatabase = vi.fn(() => ({}) as never);
    let output = "";
    await runV213CleanupReceiptCli(
      ["--finalize-cleanup-receipt", "FINALIZE_EXACT_V2_13_CLEANUP_RECEIPT"],
      {
        environment,
        readFd,
        createOperatorDatabase,
        createFinalizer,
        write: (value) => (output += value),
      },
    );
    expect(JSON.parse(output)).toEqual(result);
    const { schemaVersion, requestSha256, ...finalizeRequest } = request;
    expect(schemaVersion).toBe("videoforge.v213-local-cleanup-receipt-finalization-request/v2");
    expect(requestSha256).toBe(canonicalSha256(unsigned));
    expect(finalize).toHaveBeenCalledWith(finalizeRequest);
    expect(createOperatorDatabase).toHaveBeenCalledOnce();
    expect(() =>
      readV213CleanupReceiptProtectedInputs(
        { ...environment, [V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd]: "33" },
        readFd,
      ),
    ).toThrowError(expect.objectContaining({ code: "CLEANUP_RECEIPT_AMBIENT_BINDING_REJECTED" }));
  });

  it("submits an exact protected visual decision without constructing provider clients", async () => {
    const unsigned = {
      schemaVersion: "videoforge.v213-operator-evidence-ingestion-request/v1" as const,
      binding: {
        fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
        operationId: "v2-12-long-output" as const,
        checkpoint: "V2-12" as const,
        stageAuthorityId: "22222222-2222-4222-8222-222222222222",
        outerStateSha256: canonicalSha256({ outer: true }),
        workflowId: "v213-v2-12-execution-1",
        executionId: "execution-1",
        executionRequestSha256: canonicalSha256({ execution: true }),
        authoritySha256: canonicalSha256({ authority: true }),
      },
      evidence: {
        schemaVersion: "videoforge.v213-v212-visual-decision-evidence/v1" as const,
        kind: "V212_VISUAL_DECISION" as const,
        scope: {
          accountId: "30000000-0000-4000-8000-000000000001",
          workspaceId: "30000000-0000-4000-8000-000000000002",
          projectId: "30000000-0000-4000-8000-000000000003",
          projectRevisionId: "30000000-0000-4000-8000-000000000004",
          requestSha256: canonicalSha256({ scope: true }),
          attemptId: "attempt-1",
        },
        outputSha256: canonicalSha256({ output: true }),
        outputReceiptSha256: canonicalSha256({ outputReceipt: true }),
        decision: "ACCEPTED" as const,
        review: {
          reviewedCutCount: 90,
          everyCutReviewed: true as const,
          noManualMediaEditOrSubstitution: true as const,
          hardCutsOnly: true as const,
          overlaysAbsent: true as const,
          requiredSlowImageZoom: true as const,
          visualQualityPassed: true as const,
          audioVideoQualityPassed: true as const,
        },
        observedAt: "2026-08-28T10:00:00.000Z",
      },
      issuedAt: "2026-08-28T10:00:01.000Z",
      nonce: "operator-evidence-nonce-0001",
    };
    const request = { ...unsigned, requestSha256: canonicalSha256(unsigned) };
    const workerOrigin = "https://videoforge.example";
    const workerOperatorBearer = "operator-secret-that-is-at-least-thirty-two-bytes";
    const values = new Map([
      ["30", JSON.stringify(request)],
      ["31", workerOrigin],
      ["32", workerOperatorBearer],
    ]);
    const environment = {
      [V213_OPERATOR_EVIDENCE_ENVIRONMENT.requestFd]: "30",
      [V213_OPERATOR_EVIDENCE_ENVIRONMENT.workerOriginFd]: "31",
      [V213_OPERATOR_EVIDENCE_ENVIRONMENT.workerOperatorBearerFd]: "32",
    };
    const readFd = (fd: string | undefined) => values.get(fd ?? "") ?? "";
    expect(
      readV213OperatorEvidenceProtectedInputs(
        environment,
        readFd,
        () => new Date("2026-08-28T10:00:02.000Z"),
      ),
    ).toMatchObject({ request, workerOrigin });
    const result = {
      schemaVersion: "videoforge.v213-operator-evidence-ingestion-result/v1",
      fullLiveAuthorityId: request.binding.fullLiveAuthorityId,
      operationId: request.binding.operationId,
      checkpoint: request.binding.checkpoint,
      workflowId: request.binding.workflowId,
      executionRequestSha256: request.binding.executionRequestSha256,
      kind: request.evidence.kind,
      evidenceSha256: canonicalSha256(request.evidence),
      state: "RECORDED",
      recordedAt: "2026-08-28T10:00:02.000Z",
    } as const;
    const fetchPort = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual(
        expect.objectContaining({ authorization: `Bearer ${workerOperatorBearer}` }),
      );
      return Response.json(result, {
        status: 201,
        headers: { "cache-control": "no-store" },
      });
    });
    let output = "";
    await runV213OperatorEvidenceIngestionCli(
      ["--ingest-operator-evidence", "INGEST_EXACT_V2_13_OPERATOR_EVIDENCE"],
      {
        environment,
        readFd,
        fetch: fetchPort,
        now: () => new Date("2026-08-28T10:00:02.000Z"),
        write: (value) => (output += value),
      },
    );
    expect(JSON.parse(output)).toEqual(result);
    expect(fetchPort).toHaveBeenCalledOnce();
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
        authorizedUnsettled: false,
        reconciliationOnly: false,
        providerDispatchForbidden: false,
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

  it("executes pre-bootstrap cleanup with real RunPod reads and zero database calls", async () => {
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
    const inventory = vi.fn(async () => ({
      checkedAt: "2026-08-28T10:00:00.000Z",
      runningPods: 0,
      activeWorkers: 0,
      queuedJobs: 0,
      endpointIdSha256s: [],
      templateIdSha256s: [],
      volumes: [
        {
          idSha256: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
          sizeGb: 50,
          region: "EU-RO-1",
          manifestSha256: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
        },
        {
          idSha256: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
          sizeGb: 50,
          region: "EU-RO-1",
          manifestSha256: "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
        },
      ],
    }));
    const transport = {
      inventory,
      billingAmount: vi.fn(async () => 3),
      cleanupAttributableResources: vi.fn(),
    };
    const createEarlyRuntime = vi.fn((inputs) =>
      createV213EarlyCleanupRuntime(inputs, {
        createTransport: () => transport as never,
        sleep: vi.fn(),
      }),
    );
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
      },
    });
    expect(inventory).toHaveBeenCalledTimes(3);
    expect(() => readV213EarlyCleanupProtectedInputs(environment, readFd)).not.toThrow();
  });

  it("refuses an early-cleanup zero-worker proof when real inventory has active compute", async () => {
    const authorityId = "11111111-1111-4111-8111-111111111111";
    const request = {
      schemaVersion: "videoforge.v213-full-live-command/v1",
      commandId: "cleanup:early:active-compute",
      stageAuthorityId: authorityId,
      command: "prove-zero-workers",
      input: {
        schemaVersion: "videoforge.v213-full-live-early-cleanup-input/v1",
        fullLiveAuthorityId: authorityId,
      },
    } as const;
    const runtime = await createV213EarlyCleanupRuntime(
      { request, runpodApiKey: "r".repeat(32), earlyCleanupInput: request.input },
      {
        createTransport: () =>
          ({
            inventory: vi.fn(async () => ({
              runningPods: 1,
              activeWorkers: 1,
              queuedJobs: 0,
              volumes: [],
            })),
            billingAmount: vi.fn(),
            cleanupAttributableResources: vi.fn(),
          }) as never,
        sleep: vi.fn(),
      },
    );
    await expect(executeV213FullLiveCommand(request, runtime)).rejects.toThrow(
      "ZERO_WORKERS_NOT_PROVEN",
    );
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
          authorizedUnsettled: false,
          reconciliationOnly: false,
          providerDispatchForbidden: false,
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
        authorizedUnsettled: false,
        reconciliationOnly: false,
        providerDispatchForbidden: false,
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

  it("binds exact qualified-production rollback proof into both promotion-aware cleanup results", async () => {
    const authorityId = "11111111-1111-4111-8111-111111111111";
    const unsignedProof = {
      schemaVersion: "videoforge.v213-qualified-production-cleanup-proof/v1",
      fullLiveAuthorityId: authorityId,
      promotionId: "22222222-2222-4222-8222-222222222222",
      state: "DISABLED_UNQUALIFIED",
      enabled: false,
      gpuDispatchPerformed: false,
      productionRedispatched: false,
      providerReadbackPassed: true,
      routeStatus: 503,
      disabledConfigSha256: `sha256:${"d".repeat(64)}`,
      disabledVersionSha256: `sha256:${"e".repeat(64)}`,
      databasePromotionAttempted: true,
      databasePromotionSha256: `sha256:${"a".repeat(64)}`,
      databaseRollbackRecorded: true,
      databaseRollbackSha256: `sha256:${"f".repeat(64)}`,
    } as const;
    const proof = {
      ...unsignedProof,
      proofSha256: canonicalSha256(unsignedProof),
    } as const;
    const requestValue = {
      schemaVersion: "videoforge.v213-full-live-command/v1",
      commandId: "cleanup:promotion-aware",
      stageAuthorityId: authorityId,
      command: "restore-endpoints-max-one",
      input: {
        schemaVersion: "videoforge.v213-full-live-cleanup-input/v1",
        fullLiveAuthorityId: authorityId,
        billingBaselineMode: "PRIOR_FRESH_PREFLIGHT",
        billingBaselineUsd: 0,
        totalCapUsd: 17.5,
        authorizedUnsettled: false,
        reconciliationOnly: false,
        providerDispatchForbidden: false,
        qualifiedProductionCleanup: proof,
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
      ["10", JSON.stringify(requestValue)],
      ["11", "r".repeat(32)],
      [
        "12",
        "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
      ],
    ]);
    const environment = {
      [V213_BRIDGE_ENVIRONMENT.command]: requestValue.command,
      [V213_BRIDGE_ENVIRONMENT.requestFd]: "10",
      [V213_BRIDGE_ENVIRONMENT.runpodApiKeyFd]: "11",
      [V213_BRIDGE_ENVIRONMENT.operatorDatabaseUrlFd]: "12",
    };
    const readFd = (fd: string | undefined) => values.get(fd ?? "") ?? "";
    const protectedInputs = readV213CleanupProtectedInputs(environment, readFd);
    const database = {
      query: vi.fn(async () => ({
        rows: [
          {
            value: {
              schemaVersion: "videoforge.v213-cleanup-scope/v1",
              fullLiveAuthorityId: authorityId,
              stages: [],
            },
          },
        ],
      })),
      transaction: vi.fn(),
    };
    const transport = {
      cleanupAttributableResources: vi.fn(async () => ({
        production: [],
        productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
        productionResourcesAbsent: true,
        deletedEndpointIdSha256s: [],
        deletedTemplateIdSha256s: [],
      })),
      inventory: vi.fn(async () => ({
        checkedAt: "2026-08-29T00:00:00.000Z",
        runningPods: 0,
        activeWorkers: 0,
        queuedJobs: 0,
        endpointIdSha256s: [],
        templateIdSha256s: [],
        volumes: requestValue.input.retainedLanes.map((lane) => ({
          idSha256: lane.volumeIdSha256,
          sizeGb: 50,
          region: "EU-RO-1",
          manifestSha256: lane.volumeManifestSha256,
        })),
      })),
      billingAmount: vi.fn(),
    };
    const runtime = await createV213CleanupRuntime(protectedInputs, {
      createOperatorDatabase: () => database as never,
      createTransport: () => transport as never,
    });
    const restored = await runtime.handlers["restore-endpoints-max-one"](requestValue);
    const reconciled = await runtime.handlers["reconcile-exact-resources"]({
      ...requestValue,
      command: "reconcile-exact-resources",
    });
    expect((restored.summary as Record<string, unknown>).qualifiedProductionCleanup).toEqual(proof);
    expect((reconciled.summary as Record<string, unknown>).qualifiedProductionCleanup).toEqual(
      proof,
    );
    expect(transport.cleanupAttributableResources).toHaveBeenCalledOnce();
    expect(transport.inventory).toHaveBeenCalledOnce();

    const mutated = {
      ...requestValue,
      input: {
        ...requestValue.input,
        qualifiedProductionCleanup: { ...proof, productionRedispatched: true },
      },
    };
    values.set("10", JSON.stringify(mutated));
    expect(() => readV213CleanupProtectedInputs(environment, readFd)).toThrowError(
      expect.objectContaining({ code: "QUALIFIED_PRODUCTION_CLEANUP_PROOF_INVALID" }),
    );
  });

  it("hard-routes provider-dispatch-forbidden endpoint cleanup to read-only reconciliation", async () => {
    const authorityId = "11111111-1111-4111-8111-111111111111";
    const requestValue = {
      schemaVersion: "videoforge.v213-full-live-command/v1",
      commandId: "cleanup:readback-only",
      stageAuthorityId: authorityId,
      command: "restore-endpoints-max-one",
      input: {
        schemaVersion: "videoforge.v213-full-live-cleanup-input/v1",
        fullLiveAuthorityId: authorityId,
        billingBaselineMode: "PRIOR_FRESH_PREFLIGHT",
        billingBaselineUsd: 0,
        totalCapUsd: 17.5,
        authorizedUnsettled: true,
        reconciliationOnly: true,
        providerDispatchForbidden: true,
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
    const database = {
      query: vi.fn(async () => ({
        rows: [
          {
            value: {
              schemaVersion: "videoforge.v213-cleanup-scope/v1",
              fullLiveAuthorityId: authorityId,
              stages: [],
            },
          },
        ],
      })),
      transaction: vi.fn(),
    };
    const cleanupAttributableResources = vi.fn(async () => {
      throw new Error("MUTATING_CLEANUP_MUST_NOT_RUN");
    });
    const reconciliationReadback = {
      providerMutationPerformed: false,
      runningPods: 0,
      activeWorkers: 0,
      queuedJobs: 0,
      observedJobs: [],
      endpointIdSha256s: [],
      templateIdSha256s: [],
      volumeIdSha256s: requestValue.input.retainedLanes.map((lane) => lane.volumeIdSha256).sort(),
    } as const;
    const reconcileAttributableCleanupReadback = vi.fn(async () => ({
      production: [],
      productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT" as const,
      productionResourcesAbsent: true,
      deletedEndpointIdSha256s: [],
      deletedTemplateIdSha256s: [],
      reconciliationReadback,
    }));
    const runtime = await createV213CleanupRuntime(
      {
        request: requestValue,
        runpodApiKey: "r".repeat(32),
        operatorDatabaseUrl:
          "postgresql://videoforge_hosted_operator:password@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
        cleanupInput: requestValue.input,
      },
      {
        createOperatorDatabase: () => database as never,
        createTransport: () =>
          ({
            cleanupAttributableResources,
            reconcileAttributableCleanupReadback,
            inventory: vi.fn(),
            billingAmount: vi.fn(),
          }) as never,
      },
    );
    await expect(
      runtime.handlers["restore-endpoints-max-one"](requestValue),
    ).resolves.toMatchObject({ summary: { reconciliationReadback } });
    expect(reconcileAttributableCleanupReadback).toHaveBeenCalledOnce();
    expect(cleanupAttributableResources).not.toHaveBeenCalled();
  });

  it("never redispatches an ambiguous non-cleanup command but permits cleanup reconciliation", async () => {
    const blocked = runtime("RECONCILE");
    await expect(
      executeV213FullLiveCommand(request("v2-10-operator-free-ranga-pilot"), blocked),
    ).rejects.toEqual(expect.objectContaining({ code: "AMBIGUOUS_REDISPATCH_FORBIDDEN" }));
    expect(blocked.handlers["v2-10-operator-free-ranga-pilot"]).not.toHaveBeenCalled();

    const fencedCleanupRequest = {
      ...request("reconcile-exact-resources"),
      input: {
        authorizedUnsettled: true,
        reconciliationOnly: true,
        providerDispatchForbidden: true,
      },
    } as V213FullLiveCommandRequest;
    const forbiddenInitialDispatch = runtime("EXECUTE");
    await expect(
      executeV213FullLiveCommand(fencedCleanupRequest, forbiddenInitialDispatch),
    ).rejects.toEqual(expect.objectContaining({ code: "PROVIDER_REDISPATCH_FORBIDDEN" }));
    expect(forbiddenInitialDispatch.handlers["reconcile-exact-resources"]).not.toHaveBeenCalled();

    const cleanup = runtime("RECONCILE");
    await expect(executeV213FullLiveCommand(fencedCleanupRequest, cleanup)).resolves.toMatchObject({
      state: "TERMINAL",
    });
    expect(cleanup.handlers["reconcile-exact-resources"]).toHaveBeenCalledOnce();
  });

  it("cancels an in-flight provider wait, journals ambiguity, and never completes it", async () => {
    const controller = new AbortController();
    const base = runtime();
    let started!: () => void;
    const waiting = new Promise<void>((resolveStarted) => {
      started = resolveStarted;
    });
    const handler: V213FullLiveCommandHandler = vi.fn(async () => {
      started();
      return new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("cancelled wait")), {
          once: true,
        });
      });
    });
    const fixture: V213FullLiveBridgeRuntime = {
      ...base,
      handlers: { ...base.handlers, "mage-live-qualification": handler },
      cancellation: { signal: controller.signal },
    };
    const executing = executeV213FullLiveCommand(request("mage-live-qualification"), fixture);
    await waiting;
    controller.abort();
    await expect(executing).rejects.toEqual(
      expect.objectContaining({ code: "CANCELLATION_REQUESTED" }),
    );
    expect(fixture.journal.ambiguous).toHaveBeenCalledOnce();
    expect(fixture.journal.complete).not.toHaveBeenCalled();
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
    const { privateKey: stagePrivateKey } = generateKeyPairSync("ed25519");
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
            volumeIdSha256: `sha256:${"2".repeat(64)}`,
            volumeManifestSha256: `sha256:${"3".repeat(64)}`,
          },
          soulx: {
            lane: "soulx",
            publicImage: `ghcr.io/example/soulx@sha256:${"4".repeat(64)}`,
            sourceCommit: "4".repeat(40),
            deploymentSha256: `sha256:${"4".repeat(64)}`,
            volumeIdSha256: `sha256:${"5".repeat(64)}`,
            volumeManifestSha256: `sha256:${"6".repeat(64)}`,
          },
          billingBaselineUsd: 0,
          totalCapUsd: 17.5,
          mageQualificationCapUsd: 4.5,
          soulxQualificationCapUsd: 1,
          qualificationEnvelopeSchemaSha256: `sha256:${"7".repeat(64)}`,
          envelopeSigningKeyId: "pair-envelope-key-1",
          ...qualificationStaticBindings(),
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
        stageAuthoritySigningKeyBase64: stagePrivateKey
          .export({ type: "pkcs8", format: "der" })
          .toString("base64"),
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

  it("rejects corrupted SoulX protected bytes before DB, R2, or RunPod construction", async () => {
    const secret = (byte: number) => Buffer.alloc(32, byte).toString("base64");
    const { privateKey: stagePrivateKey } = generateKeyPairSync("ed25519");
    const sourceBytes = {
      avatarSource: new Uint8Array(64).fill(1),
      soulx2s: new Uint8Array(64).fill(2),
      soulx4s: new Uint8Array(64).fill(3),
      soulx6s: new Uint8Array(64).fill(4),
      soulx10s: new Uint8Array(64).fill(5),
    };
    const protectedDescriptor = (
      path: string,
      bytes: Uint8Array,
      contentType: "image/png" | "audio/wav",
    ) => ({
      path,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      sizeBytes: bytes.byteLength,
      contentType,
    });
    const staticBindings = qualificationStaticBindings();
    const productionRequest = {
      ...request("soulx-live-qualification"),
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
            volumeIdSha256: `sha256:${"2".repeat(64)}`,
            volumeManifestSha256: `sha256:${"3".repeat(64)}`,
          },
          soulx: {
            lane: "soulx",
            publicImage: `ghcr.io/example/soulx@sha256:${"4".repeat(64)}`,
            sourceCommit: "1".repeat(40),
            deploymentSha256: `sha256:${"4".repeat(64)}`,
            volumeIdSha256: `sha256:${"5".repeat(64)}`,
            volumeManifestSha256: `sha256:${"6".repeat(64)}`,
          },
          billingBaselineUsd: 0,
          totalCapUsd: 17.5,
          mageQualificationCapUsd: 4.5,
          soulxQualificationCapUsd: 1,
          qualificationEnvelopeSchemaSha256: `sha256:${"7".repeat(64)}`,
          envelopeSigningKeyId: "pair-envelope-key-1",
          ...staticBindings,
          qualificationProtectedInputDescriptors: {
            avatarSource: protectedDescriptor(
              ".videoforge/private/avatar.png",
              sourceBytes.avatarSource,
              "image/png",
            ),
            soulx2s: protectedDescriptor(
              ".videoforge/private/audio-2s.wav",
              sourceBytes.soulx2s,
              "audio/wav",
            ),
            soulx4s: protectedDescriptor(
              ".videoforge/private/audio-4s.wav",
              sourceBytes.soulx4s,
              "audio/wav",
            ),
            soulx6s: protectedDescriptor(
              ".videoforge/private/audio-6s.wav",
              sourceBytes.soulx6s,
              "audio/wav",
            ),
            soulx10s: protectedDescriptor(
              ".videoforge/private/audio-10s.wav",
              sourceBytes.soulx10s,
              "audio/wav",
            ),
          },
        },
        commandPayload: {},
      },
    } as never;
    const corrupted = {
      ...sourceBytes,
      avatarSource: Uint8Array.from(sourceBytes.avatarSource, (value, index) =>
        index === 8 ? value ^ 1 : value,
      ),
    };
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
        stageAuthoritySigningKeyBase64: stagePrivateKey
          .export({ type: "pkcs8", format: "der" })
          .toString("base64"),
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
      qualification: {
        r2: {
          accountId: staticBindings.qualificationR2.accountId,
          bucketName: staticBindings.qualificationR2.bucketName,
          accessKeyId: "A".repeat(24),
          secretAccessKey: "S".repeat(40),
        },
        sourceBytes: corrupted,
      },
    } as const;
    const createDatabases = vi.fn();
    const fetchPort = vi.fn();
    await expect(
      createV213ProductionRuntime(protectedInputs, {
        fetch: fetchPort,
        now: () => new Date("2026-08-26T00:00:00.000Z"),
        sleep: vi.fn(),
        createDatabases,
      }),
    ).rejects.toThrow("V213_QUALIFICATION_PROTECTED_INPUT_DRIFT");
    expect(createDatabases).not.toHaveBeenCalled();
    expect(fetchPort).not.toHaveBeenCalled();
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

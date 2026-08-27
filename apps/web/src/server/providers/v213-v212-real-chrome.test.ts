import { EventEmitter } from "node:events";
import { createHash, createHmac } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { canonicalSha256 } from "@videoforge/control-plane";
import { canonicalizeJson } from "@videoforge/contracts";

import { v213EvidenceKeyId } from "../hosted/v213-live-production-adapters.js";
import {
  buildV213V212RealChromeRequest,
  createV213V212RealChromeJourneySpawner,
  produceV213V212RealChromeEvidence,
  runV213V212RealChromeJourney,
  submitV213V212RealChromeEvidence,
  validateV213V212RealChromeRequest,
  verifyV213V212RealChromeChildReceipt,
  V213_V212_REAL_CHROME_CHILD_RECEIPT_SCHEMA,
  V213_V212_REAL_CHROME_OBSERVATION_SCHEMA,
  type LaunchV213V212InstalledChrome,
  type V213V212RealChromeChildReceipt,
  type V213V212RealChromeObservation,
  type V213V212RealChromeRequest,
} from "./v213-v212-real-chrome.js";

const NOW = new Date("2026-08-28T00:05:00.000Z");
const ORIGIN = "https://videoforge.example";
const OUTPUT = Buffer.from("v212-terminal-output");
const OUTPUT_SHA256 = `sha256:${createHash("sha256").update(OUTPUT).digest("hex")}` as const;
const OUTPUT_RECEIPT_SHA256 = `sha256:${"b".repeat(64)}` as const;
const KEY = new Uint8Array(32).fill(17);
const SOURCE_PINS = Object.freeze({
  moduleSha256: "sha256:9dacdaa2cbacb610fde13b14005a171b4758c422ba0642afa2f6daedf5528cf1",
  entrySha256: "sha256:e14ec781c7df011b45ea012d439044b1b59d4888f039c51aa08e29277c50b411",
} as const);
const IDS = Object.freeze({
  fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
  stageAuthorityId: "22222222-2222-4222-8222-222222222222",
  accountId: "33333333-3333-4333-8333-333333333333",
  workspaceId: "44444444-4444-4444-8444-444444444444",
  projectId: "55555555-5555-4555-8555-555555555555",
  projectRevisionId: "66666666-6666-4666-8666-666666666666",
  attemptId: "attempt-v212-terminal",
  executionId: "execution-v212-terminal",
});

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function originHash(): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(ORIGIN, "utf8").digest("hex")}`;
}

function request(
  overrides: Partial<Parameters<typeof buildV213V212RealChromeRequest>[0]> = {},
  now: Date = NOW,
): V213V212RealChromeRequest {
  return buildV213V212RealChromeRequest(
    {
      fullLiveAuthorityId: IDS.fullLiveAuthorityId,
      stageAuthorityId: IDS.stageAuthorityId,
      outerStateSha256: hash("outer-state"),
      operationId: "v2-12-long-output",
      checkpoint: "V2-12",
      workflowId: `v213-v2-12-${IDS.executionId}`,
      executionId: IDS.executionId,
      executionRequestSha256: hash("execution-request"),
      authoritySha256: hash("full-live-authority"),
      accountId: IDS.accountId,
      workspaceId: IDS.workspaceId,
      projectId: IDS.projectId,
      projectRevisionId: IDS.projectRevisionId,
      attemptId: IDS.attemptId,
      scopeRequestSha256: hash("scope-request"),
      outputSha256: OUTPUT_SHA256,
      outputReceiptSha256: OUTPUT_RECEIPT_SHA256,
      outputBytes: OUTPUT.length,
      productionUrlSha256: originHash(),
      terminalAt: "2026-08-28T00:00:00.000Z",
      workloadDeadlineAt: "2026-08-28T00:10:00.000Z",
      fullAuthorityExpiresAt: "2026-08-28T00:20:00.000Z",
      deadlineAt: "2026-08-28T00:10:00.000Z",
      ...overrides,
    },
    now,
  );
}

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v212-real-chrome-test-"));
  chmodSync(directory, 0o700);
  return directory;
}

function authState(directory: string): string {
  const authDirectory = mkdtempSync(join(directory, "auth-"));
  chmodSync(authDirectory, 0o700);
  const path = join(authDirectory, "state.json");
  writeFileSync(path, '{"cookies":[],"origins":[]}', { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function writeRequest(directory: string, value: V213V212RealChromeRequest): string {
  const path = join(directory, "request.json");
  writeFileSync(path, canonicalizeJson(value as never), { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

function observation(
  value: V213V212RealChromeRequest,
  overrides: Partial<V213V212RealChromeObservation> = {},
): V213V212RealChromeObservation {
  return {
    schemaVersion: V213_V212_REAL_CHROME_OBSERVATION_SCHEMA,
    requestSha256: value.requestSha256,
    fullLiveAuthorityId: value.fullLiveAuthorityId,
    stageAuthorityId: value.stageAuthorityId,
    outerStateSha256: value.outerStateSha256,
    operationId: value.operationId,
    workflowId: value.workflowId,
    executionId: value.executionId,
    executionRequestSha256: value.executionRequestSha256,
    authoritySha256: value.authoritySha256,
    accountId: value.accountId,
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    projectRevisionId: value.projectRevisionId,
    attemptId: value.attemptId,
    scopeRequestSha256: value.scopeRequestSha256,
    outputSha256: value.outputSha256,
    outputReceiptSha256: value.outputReceiptSha256,
    productionUrlSha256: value.productionUrlSha256,
    terminalAt: value.terminalAt,
    workloadDeadlineAt: value.workloadDeadlineAt,
    fullAuthorityExpiresAt: value.fullAuthorityExpiresAt,
    browser: "GOOGLE_CHROME",
    authenticatedSession: true,
    fixtureOrFakeTransportUsed: false,
    privateTenantReadbackPassed: true,
    privateProjectReadbackPassed: true,
    privateRevisionReadbackPassed: true,
    playbackPassed: true,
    playbackDurationSeconds: 1_800,
    downloadSha256: value.outputSha256,
    downloadBytes: value.outputBytes,
    observedAt: NOW.toISOString(),
    ...overrides,
  };
}

function signedReceipt(
  value: V213V212RealChromeRequest,
  overrides: Partial<V213V212RealChromeObservation> = {},
): V213V212RealChromeChildReceipt {
  const document = observation(value, overrides);
  const observationSha256 = canonicalSha256(document);
  const signatureHex = createHmac("sha256", Buffer.from(KEY))
    .update(`V212_REAL_CHROME\n${value.requestSha256}\n${observationSha256}`, "utf8")
    .digest("hex");
  return {
    schemaVersion: V213_V212_REAL_CHROME_CHILD_RECEIPT_SCHEMA,
    requestSha256: value.requestSha256,
    observationSha256,
    keyId: v213EvidenceKeyId(KEY),
    signatureHex,
    document,
  };
}

function fakeBrowser(input: {
  readonly request: V213V212RealChromeRequest;
  readonly tenant?: Record<string, unknown>;
  readonly project?: Record<string, unknown>;
  readonly outputs?: readonly Record<string, unknown>[];
  readonly durationSeconds?: number;
  readonly downloadedBytes?: Buffer;
  readonly launcher?: (options: { channel: "chrome"; headless: false }) => void;
  readonly launchNever?: boolean;
}) {
  const outputUrl = "https://r2.example.test/v212-output?signature=opaque";
  const downloadDirectory = mkdtempSync(join(tmpdir(), "videoforge-v212-download-"));
  chmodSync(downloadDirectory, 0o700);
  const downloadPath = join(downloadDirectory, "output.mp4");
  writeFileSync(downloadPath, input.downloadedBytes ?? OUTPUT, { mode: 0o600 });
  const tenant = input.tenant ?? {
    schema_version: "videoforge-hosted-tenant/v1",
    account_id: input.request.accountId,
    workspace_id: input.request.workspaceId,
  };
  const project = input.project ?? {
    id: input.request.projectId,
    revision_id: input.request.projectRevisionId,
  };
  const outputs = input.outputs ?? [
    {
      attempt_id: input.request.attemptId,
      project_id: input.request.projectId,
      title: "V2-12 terminal output",
      created_at: "2026-08-28T00:01:00.000Z",
      content_length: input.request.outputBytes,
      checksum_sha256: input.request.outputSha256,
      download_url: outputUrl,
      download_expires_at: "2099-01-01T00:00:00.000Z",
    },
  ];
  const page = {
    async goto() {
      return undefined;
    },
    async evaluate(_callback: unknown, argument?: unknown) {
      const path = (argument as { path?: unknown } | undefined)?.path;
      if (path === "/api/v2/tenant") return { status: 200, body: JSON.stringify(tenant) };
      if (path === "/api/v2/library")
        return {
          status: 200,
          body: JSON.stringify({ schema_version: "videoforge-hosted-library/v1", outputs }),
        };
      if (typeof path === "string" && path.startsWith("/api/v2/hosted/projects/"))
        return {
          status: 200,
          body: JSON.stringify({
            project,
            attempts: [
              {
                id: input.request.attemptId,
                kind: "RENDER",
                state: "SUCCEEDED",
                output_checksum_sha256: input.request.outputSha256,
              },
            ],
          }),
        };
      throw new Error(`unexpected API path ${String(path)}`);
    },
    locator(selector: string) {
      const attribute = selector === "video" ? "src" : "href";
      return {
        async count() {
          return 1;
        },
        nth() {
          return this;
        },
        async getAttribute(name: string) {
          return name === attribute ? outputUrl : null;
        },
        async evaluate() {
          return { durationSeconds: input.durationSeconds ?? 1_800, currentTime: 1 };
        },
        async click() {
          return undefined;
        },
      };
    },
    async waitForEvent() {
      return {
        async path() {
          return downloadPath;
        },
        async failure() {
          return null;
        },
        async delete() {
          rmSync(downloadPath, { force: true });
        },
      };
    },
    async close() {
      return undefined;
    },
  };
  const context = {
    async route() {
      return undefined;
    },
    async newPage() {
      return page;
    },
    async close() {
      return undefined;
    },
  };
  const browser = {
    async newContext() {
      return context;
    },
    async close() {
      rmSync(downloadDirectory, { recursive: true, force: true });
    },
  };
  const launch = vi.fn(async (options: { channel: "chrome"; headless: false }) => {
    input.launcher?.(options);
    if (input.launchNever) return new Promise<never>(() => undefined);
    return browser;
  });
  return { launch: launch as unknown as LaunchV213V212InstalledChrome };
}

function resultFor(
  operatorRequest: Parameters<
    NonNullable<Parameters<typeof produceV213V212RealChromeEvidence>[0]["submit"]>
  >[0]["request"],
) {
  return {
    schemaVersion: "videoforge.v213-operator-evidence-ingestion-result/v1" as const,
    fullLiveAuthorityId: operatorRequest.binding.fullLiveAuthorityId,
    operationId: operatorRequest.binding.operationId,
    checkpoint: operatorRequest.binding.checkpoint,
    workflowId: operatorRequest.binding.workflowId,
    executionRequestSha256: operatorRequest.binding.executionRequestSha256,
    kind: operatorRequest.evidence.kind,
    evidenceSha256: canonicalSha256(operatorRequest.evidence),
    state: "RECORDED" as const,
    recordedAt: operatorRequest.issuedAt,
  };
}

describe("V2-12 real Chrome producer", () => {
  it("builds and validates a terminal-bound request with a bounded full-live deadline", () => {
    const value = request();
    expect(validateV213V212RealChromeRequest(value, NOW)).toEqual(value);
    expect(value.deadlineAt).toBe(value.workloadDeadlineAt);
    expect(() =>
      validateV213V212RealChromeRequest(request({ terminalAt: "2026-08-28T00:05:00.001Z" }), NOW),
    ).toThrowError("V213_V212_REAL_CHROME_REQUEST_DEADLINE_INVALID");
  });

  it("launches installed Google Chrome only after terminal output binding, then proves tenant/private readback, playback, and full download hash", async () => {
    const directory = workspace();
    try {
      const value = request();
      const browser = fakeBrowser({
        request: value,
        launcher: (options) => expect(options).toEqual({ channel: "chrome", headless: false }),
      });
      const receipt = await runV213V212RealChromeJourney({
        requestPath: writeRequest(directory, value),
        productionOrigin: ORIGIN,
        authStatePath: authState(directory),
        evidenceSigningKey: KEY,
        now: () => NOW,
        sleep: async () => undefined,
        launch: browser.launch,
      });
      expect(browser.launch).toHaveBeenCalledOnce();
      expect(receipt.document).toMatchObject({
        browser: "GOOGLE_CHROME",
        authenticatedSession: true,
        fixtureOrFakeTransportUsed: false,
        privateTenantReadbackPassed: true,
        privateProjectReadbackPassed: true,
        privateRevisionReadbackPassed: true,
        playbackPassed: true,
        playbackDurationSeconds: 1_800,
        downloadSha256: OUTPUT_SHA256,
        downloadBytes: OUTPUT.length,
      });
      expect(verifyV213V212RealChromeChildReceipt(receipt, value, KEY, NOW).accepted).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed for cross-tenant, stale/wrong output, and wrong output receipt evidence", async () => {
    const directory = workspace();
    try {
      const value = request();
      const tenantBrowser = fakeBrowser({
        request: value,
        tenant: {
          schema_version: "videoforge-hosted-tenant/v1",
          account_id: "77777777-7777-4777-8777-777777777777",
          workspace_id: value.workspaceId,
        },
      });
      await expect(
        runV213V212RealChromeJourney({
          requestPath: writeRequest(directory, value),
          productionOrigin: ORIGIN,
          authStatePath: authState(directory),
          evidenceSigningKey: KEY,
          now: () => NOW,
          launch: tenantBrowser.launch,
        }),
      ).rejects.toThrowError("V213_V212_REAL_CHROME_TENANT_SCOPE_INVALID");
      const outputBrowser = fakeBrowser({
        request: value,
        outputs: [
          {
            attempt_id: value.attemptId,
            project_id: value.projectId,
            title: "stale",
            created_at: "2026-08-28T00:01:00.000Z",
            content_length: value.outputBytes,
            checksum_sha256: hash("stale-output"),
            download_url: "https://r2.example.test/stale",
            download_expires_at: "2099-01-01T00:00:00.000Z",
          },
        ],
      });
      await expect(
        runV213V212RealChromeJourney({
          requestPath: writeRequest(directory, value),
          productionOrigin: ORIGIN,
          authStatePath: authState(directory),
          evidenceSigningKey: KEY,
          now: () => NOW,
          launch: outputBrowser.launch,
        }),
      ).rejects.toThrowError("V213_V212_REAL_CHROME_LIBRARY_OUTPUT_NOT_FOUND");
      expect(() =>
        verifyV213V212RealChromeChildReceipt(
          signedReceipt(value, { outputReceiptSha256: hash("wrong-receipt") }),
          value,
          KEY,
          NOW,
        ),
      ).toThrowError("V213_V212_REAL_CHROME_OBSERVATION_IDENTITY_DRIFT");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects production-origin drift and fake/fixture evidence before submission", async () => {
    const directory = workspace();
    try {
      const value = request();
      const browser = fakeBrowser({ request: value });
      await expect(
        runV213V212RealChromeJourney({
          requestPath: writeRequest(directory, value),
          productionOrigin: "https://wrong.example",
          authStatePath: authState(directory),
          evidenceSigningKey: KEY,
          now: () => NOW,
          launch: browser.launch,
        }),
      ).rejects.toThrowError("V213_V212_REAL_CHROME_ORIGIN_HASH_INVALID");
      expect(browser.launch).not.toHaveBeenCalled();
      expect(() =>
        verifyV213V212RealChromeChildReceipt(
          signedReceipt(value, {
            fixtureOrFakeTransportUsed: true,
          } as unknown as Partial<V213V212RealChromeObservation>),
          value,
          KEY,
          NOW,
        ),
      ).toThrowError("V213_V212_REAL_CHROME_OBSERVATION_PROOF_INVALID");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not launch or submit when the terminal output is stale/future-bound", async () => {
    const directory = workspace();
    try {
      const value = request();
      const spawnJourney = vi.fn();
      const futureTerminal = {
        ...value,
        terminalAt: "2026-08-28T00:05:00.001Z",
      };
      const unsigned = structuredClone(futureTerminal) as Record<string, unknown>;
      delete unsigned.requestSha256;
      const invalidFutureRequest = {
        ...futureTerminal,
        requestSha256: canonicalSha256(unsigned),
      } as V213V212RealChromeRequest;
      await expect(
        produceV213V212RealChromeEvidence({
          request: invalidFutureRequest,
          productionOrigin: ORIGIN,
          workerOrigin: ORIGIN,
          authStatePath: authState(directory),
          workerOperatorBearer: "b".repeat(32),
          childSigningKeyFd: 3,
          evidenceSigningKey: KEY,
          spawnJourney,
          submit: vi.fn(),
          now: () => NOW,
        }),
      ).rejects.toThrowError("V213_V212_REAL_CHROME_REQUEST_DEADLINE_INVALID");
      expect(spawnJourney).not.toHaveBeenCalled();
      expect(value.terminalAt).toBe("2026-08-28T00:00:00.000Z");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("verifies the child receipt before submitting exact V212_REAL_CHROME evidence", async () => {
    const directory = workspace();
    try {
      const value = request();
      const child = signedReceipt(value);
      const events: string[] = [];
      const spawnJourney = vi.fn(() => {
        events.push("launch-after-terminal");
        return { receipt: Promise.resolve(child), kill: vi.fn() };
      });
      const submit = vi.fn(async ({ request: operatorRequest }) => {
        events.push("submit-after-child-proof");
        expect(operatorRequest.evidence).toMatchObject({
          kind: "V212_REAL_CHROME",
          outputSha256: value.outputSha256,
          outputReceiptSha256: value.outputReceiptSha256,
          productionUrlSha256: value.productionUrlSha256,
          chromeReceiptSha256: canonicalSha256(child),
          downloadSha256: value.outputSha256,
          downloadBytes: value.outputBytes,
        });
        return resultFor(operatorRequest);
      });
      const result = await produceV213V212RealChromeEvidence({
        request: value,
        productionOrigin: ORIGIN,
        workerOrigin: ORIGIN,
        authStatePath: authState(directory),
        workerOperatorBearer: "b".repeat(32),
        childSigningKeyFd: 3,
        evidenceSigningKey: KEY,
        spawnJourney,
        submit,
        now: () => NOW,
        nonce: "v212-test-nonce-1234",
      });
      expect(events).toEqual(["launch-after-terminal", "submit-after-child-proof"]);
      expect(result.verifiedChild.signatureVerified).toBe(true);
      expect(result.ingestion.state).toBe("RECORDED");
      expect(submit).toHaveBeenCalledOnce();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a forged child output/origin receipt and never submits", async () => {
    const directory = workspace();
    try {
      const value = request();
      const submit = vi.fn();
      const spawnJourney = vi.fn(() => ({
        receipt: Promise.resolve(signedReceipt(value, { downloadSha256: hash("forged-output") })),
        kill: vi.fn(),
      }));
      await expect(
        produceV213V212RealChromeEvidence({
          request: value,
          productionOrigin: ORIGIN,
          workerOrigin: ORIGIN,
          authStatePath: authState(directory),
          workerOperatorBearer: "b".repeat(32),
          childSigningKeyFd: 3,
          evidenceSigningKey: KEY,
          spawnJourney,
          submit,
          now: () => NOW,
        }),
      ).rejects.toThrowError("V213_V212_REAL_CHROME_OBSERVATION_PROOF_INVALID");
      expect(submit).not.toHaveBeenCalled();
      await expect(
        produceV213V212RealChromeEvidence({
          request: request({ productionUrlSha256: hash("different-origin") }),
          productionOrigin: ORIGIN,
          workerOrigin: ORIGIN,
          authStatePath: authState(directory),
          workerOperatorBearer: "b".repeat(32),
          childSigningKeyFd: 3,
          evidenceSigningKey: KEY,
          spawnJourney: vi.fn(),
          submit,
          now: () => NOW,
        }),
      ).rejects.toThrowError("V213_V212_REAL_CHROME_ORIGIN_HASH_INVALID");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("kills a hanging journey at the absolute workload/full-authority deadline", async () => {
    const directory = workspace();
    try {
      const started = new Date();
      const deadline = new Date(started.getTime() + 80);
      const value = request(
        {
          terminalAt: new Date(started.getTime() - 1_000).toISOString(),
          workloadDeadlineAt: deadline.toISOString(),
          fullAuthorityExpiresAt: new Date(started.getTime() + 200).toISOString(),
          deadlineAt: deadline.toISOString(),
        },
        started,
      );
      const kill = vi.fn();
      const spawnJourney = vi.fn(() => ({
        receipt: new Promise<V213V212RealChromeChildReceipt>(() => undefined),
        kill,
      }));
      await expect(
        produceV213V212RealChromeEvidence({
          request: value,
          productionOrigin: ORIGIN,
          workerOrigin: ORIGIN,
          authStatePath: authState(directory),
          workerOperatorBearer: "b".repeat(32),
          childSigningKeyFd: 3,
          evidenceSigningKey: KEY,
          spawnJourney,
          submit: vi.fn(),
          now: () => new Date(),
        }),
      ).rejects.toThrowError("V213_V212_REAL_CHROME_DEADLINE_EXCEEDED");
      expect(kill).toHaveBeenCalledWith("SIGKILL");
      expect(Date.now() - started.getTime()).toBeLessThan(1_000);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("submits only the exact protected operator route and does not expose the signing key", async () => {
    const directory = workspace();
    try {
      const value = request();
      const child = signedReceipt(value);
      let operatorRequest:
        | Parameters<
            NonNullable<Parameters<typeof produceV213V212RealChromeEvidence>[0]["submit"]>
          >[0]["request"]
        | undefined;
      await produceV213V212RealChromeEvidence({
        request: value,
        productionOrigin: ORIGIN,
        workerOrigin: ORIGIN,
        authStatePath: authState(directory),
        workerOperatorBearer: "b".repeat(32),
        childSigningKeyFd: 3,
        evidenceSigningKey: KEY,
        spawnJourney: vi.fn(() => ({ receipt: Promise.resolve(child), kill: vi.fn() })),
        submit: vi.fn(async ({ request }) => {
          operatorRequest = request;
          return resultFor(request);
        }),
        now: () => NOW,
        nonce: "v212-route-test-nonce",
      });
      expect(operatorRequest).toBeDefined();
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe(`${ORIGIN}/api/operator/v2-13/acceptance-evidence`);
        expect(init.method).toBe("POST");
        expect(init.headers).toMatchObject({
          authorization: `Bearer ${"b".repeat(32)}`,
          "content-type": "application/json",
        });
        expect(String(init.body)).not.toContain(Buffer.from(KEY).toString("base64"));
        return new Response(JSON.stringify(resultFor(operatorRequest!)), {
          status: 201,
          headers: { "cache-control": "no-store" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);
      const result = await submitV213V212RealChromeEvidence({
        workerOrigin: ORIGIN,
        workerOperatorBearer: "b".repeat(32),
        request: operatorRequest!,
        signal: new AbortController().signal,
      });
      expect(result.state).toBe("RECORDED");
      expect(fetchMock).toHaveBeenCalledOnce();
      vi.unstubAllGlobals();
    } finally {
      vi.unstubAllGlobals();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("passes the child signing key only through inherited fd 3 in the process spawner", async () => {
    const directory = workspace();
    try {
      const spawnerNow = new Date();
      const spawnerDeadline = new Date(spawnerNow.getTime() + 10_000).toISOString();
      const value = request(
        {
          terminalAt: new Date(spawnerNow.getTime() - 1_000).toISOString(),
          workloadDeadlineAt: spawnerDeadline,
          fullAuthorityExpiresAt: spawnerDeadline,
          deadlineAt: spawnerDeadline,
        },
        spawnerNow,
      );
      const keyPipe = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdio: [null, stdout, stderr, keyPipe],
        kill: vi.fn(),
      });
      let spawnArgs: readonly string[] | undefined;
      let spawnOptions:
        | { readonly env: NodeJS.ProcessEnv; readonly stdio: readonly unknown[] }
        | undefined;
      const spawn = vi.fn(
        (
          _command: string,
          args: readonly string[],
          options: { readonly env: NodeJS.ProcessEnv; readonly stdio: readonly unknown[] },
        ) => {
          spawnArgs = args;
          spawnOptions = options;
          setImmediate(() => child.emit("exit", 1));
          return child;
        },
      );
      const chunks: Buffer[] = [];
      keyPipe.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      const spawner = createV213V212RealChromeJourneySpawner({
        productionOrigin: ORIGIN,
        authStatePath: authState(directory),
        evidenceSigningKey: KEY,
        sourcePins: SOURCE_PINS,
        spawn: spawn as never,
      });
      const journey = spawner({
        request: value,
        childSigningKeyFd: 3,
        deadlineAt: value.deadlineAt,
        signal: new AbortController().signal,
      });
      await expect(journey.receipt).rejects.toThrowError("V213_V212_REAL_CHROME_JOURNEY_FAILED");
      expect(spawnArgs).toBeDefined();
      expect(spawnOptions).toBeDefined();
      expect(JSON.stringify(spawnArgs)).not.toContain(Buffer.from(KEY).toString("base64"));
      expect(JSON.stringify(spawnOptions!.env)).not.toContain(Buffer.from(KEY).toString("base64"));
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(KEY));
      expect(spawnOptions!.stdio).toEqual(["ignore", "pipe", "pipe", "pipe"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects V2-12 Chrome child source drift before spawning", () => {
    const value = request();
    const spawn = vi.fn();
    const spawner = createV213V212RealChromeJourneySpawner({
      productionOrigin: ORIGIN,
      authStatePath: "/protected/auth-state.json",
      evidenceSigningKey: KEY,
      sourcePins: { ...SOURCE_PINS, moduleSha256: `sha256:${"0".repeat(64)}` },
      spawn: spawn as never,
    });
    expect(() =>
      spawner({
        request: value,
        childSigningKeyFd: 3,
        deadlineAt: value.deadlineAt,
        signal: new AbortController().signal,
      }),
    ).toThrowError("V213_V212_REAL_CHROME_SOURCE_DRIFT");
    expect(spawn).not.toHaveBeenCalled();
  });
});

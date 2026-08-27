import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { canonicalizeJson } from "@videoforge/contracts";

import {
  V213_V209_CHROME_EVIDENCE_SCHEMA,
  V213_V209_CHROME_RECEIPT_SCHEMA,
  runV213ReleaseRealChromeJourney,
  runV213V209RealChromeOperator,
  spawnV213V209ChromeOperator,
} from "./v213-real-chrome-operator.js";
import type { V213V209ChromeOperatorInput } from "./v213-real-chrome-operator.js";
import {
  buildV213ReleaseChromeRequest,
  V213_RELEASE_CHROME_CHILD_RECEIPT_SCHEMA,
} from "./v213-release-real-chrome.js";
import { V213_V209_CHROME_OPERATOR_SOURCE_PINS } from "./v213-full-live-cli.js";

const OUTPUT_BYTES = Buffer.from("private-final-mp4-test-bytes");
const OUTPUT_SHA256 = `sha256:${createHash("sha256").update(OUTPUT_BYTES).digest("hex")}`;
const OUTPUT_RECEIPT_SHA256 = `sha256:${"b".repeat(64)}`;
const KEY = new Uint8Array(32).fill(17);

function requestFor(
  directory: string,
  values: Partial<{
    terminalAt: string;
    deadlineAt: string;
    finalOutputSha256: string;
    accountId: string;
  }> = {},
) {
  const generationRequestId = "11111111-1111-4111-8111-111111111111";
  const unsigned = {
    schemaVersion: "videoforge.v2-09-real-chrome-request/v1",
    workflowId: `hosted-pair-${generationRequestId}`,
    accountId: values.accountId ?? "22222222-2222-4222-8222-222222222222",
    workspaceId: "33333333-3333-4333-8333-333333333333",
    generationRequestId,
    finalOutputSha256: values.finalOutputSha256 ?? OUTPUT_SHA256,
    finalOutputReceiptSha256: OUTPUT_RECEIPT_SHA256,
    terminalAt: values.terminalAt ?? "2026-08-27T00:00:00.000Z",
    deadlineAt: values.deadlineAt ?? "2026-08-27T00:00:20.000Z",
  } as const;
  const request = {
    ...unsigned,
    requestSha256: `sha256:${createHash("sha256")
      .update(canonicalizeJson(unsigned), "utf8")
      .digest("hex")}`,
  };
  const requestPath = join(directory, `${unsigned.workflowId}.request.json`);
  writeFileSync(requestPath, canonicalizeJson(request), { encoding: "utf8", mode: 0o600 });
  chmodSync(requestPath, 0o600);
  return { request, requestPath };
}

function authState(directory: string) {
  const stateDirectory = join(directory, "auth");
  mkdirSync(stateDirectory, { mode: 0o700 });
  chmodSync(stateDirectory, 0o700);
  const authStatePath = join(stateDirectory, "state.json");
  writeFileSync(authStatePath, '{"cookies":[],"origins":[]}', {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(authStatePath, 0o600);
  return authStatePath;
}

function fakeBrowser(input: {
  readonly tenant?: Record<string, unknown>;
  readonly outputs?: readonly Record<string, unknown>[];
  readonly durationSeconds?: number;
  readonly currentTime?: number;
  readonly downloadedBytes?: Buffer;
  readonly gotoNever?: boolean;
  readonly evaluateNever?: boolean;
  readonly playbackNever?: boolean;
  readonly downloadNever?: boolean;
  readonly launcher?: (options: { channel: "chrome"; headless: false }) => void;
}) {
  const outputUrl = "https://r2.example.test/private-output?signature=opaque";
  const tenant = input.tenant ?? {
    schema_version: "videoforge-hosted-tenant/v1",
    account_id: "22222222-2222-4222-8222-222222222222",
    workspace_id: "33333333-3333-4333-8333-333333333333",
  };
  const outputs = input.outputs ?? [
    {
      attempt_id: "44444444-4444-4444-8444-444444444444",
      project_id: "55555555-5555-4555-8555-555555555555",
      title: "V2-09 acceptance",
      created_at: "2026-08-26T23:59:00.000Z",
      content_length: OUTPUT_BYTES.length,
      checksum_sha256: OUTPUT_SHA256,
      download_url: outputUrl,
      download_expires_at: "2099-01-01T00:00:00.000Z",
    },
  ];
  const downloadPath = join(mkdtempSync(join(tmpdir(), "v213-chrome-download-")), "output.mp4");
  writeFileSync(downloadPath, input.downloadedBytes ?? OUTPUT_BYTES, { mode: 0o600 });
  const page = {
    async goto() {
      if (input.gotoNever) return new Promise<never>(() => undefined);
    },
    async evaluate(_callback: unknown, argument?: unknown) {
      if (input.evaluateNever) return new Promise<never>(() => undefined);
      const requestPath =
        typeof argument === "string"
          ? argument
          : (argument as { requestPath?: unknown } | null)?.requestPath;
      if (requestPath === "/api/v2/tenant") return { status: 200, body: JSON.stringify(tenant) };
      if (requestPath === "/api/v2/library")
        return {
          status: 200,
          body: JSON.stringify({ schema_version: "videoforge-hosted-library/v1", outputs }),
        };
      if (String(requestPath).startsWith("/api/v2/hosted/projects/"))
        return {
          status: 200,
          body: JSON.stringify({
            project: {
              id: "55555555-5555-4555-8555-555555555555",
              revision_id: "66666666-6666-4666-8666-666666666666",
            },
            attempts: [
              {
                id: "44444444-4444-4444-8444-444444444444",
                kind: "RENDER",
                state: "SUCCEEDED",
                output_checksum_sha256: OUTPUT_SHA256,
              },
            ],
          }),
        };
      throw new Error("unexpected page evaluation");
    },
    locator(selector: string) {
      const source = selector === "video" ? "src" : "href";
      return {
        async count() {
          return 1;
        },
        nth() {
          return this;
        },
        async getAttribute(name: string) {
          return name === source ? outputUrl : null;
        },
        async evaluate() {
          if (input.playbackNever) return new Promise<never>(() => undefined);
          return {
            durationSeconds: input.durationSeconds ?? 40,
            currentTime: input.currentTime ?? 1,
          };
        },
        async click() {},
      };
    },
    async waitForEvent() {
      if (input.downloadNever) return new Promise<never>(() => undefined);
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
    async close() {},
  };
  const context = {
    async route() {},
    async newPage() {
      return page;
    },
    async close() {},
  };
  const browser = {
    async newContext() {
      return context;
    },
    async close() {
      rmSync(join(downloadPath, ".."), { recursive: true, force: true });
    },
  };
  const launch = vi.fn(async (options: { channel: "chrome"; headless: false }) => {
    input.launcher?.(options);
    return browser;
  });
  return { launch, outputUrl };
}

function testInput(
  directory: string,
  browser: ReturnType<typeof fakeBrowser>,
  overrides = {},
  requestValues: Partial<{
    terminalAt: string;
    deadlineAt: string;
    finalOutputSha256: string;
    accountId: string;
  }> = {},
) {
  const { requestPath } = requestFor(directory, requestValues);
  const authStatePath = authState(directory);
  return {
    requestPath,
    exchangeDirectory: directory,
    productionOrigin: "https://videoforge.example",
    authStatePath,
    evidenceSigningKey: KEY,
    launch: browser.launch,
    now: () => new Date("2026-08-27T00:00:05.000Z"),
    sleep: async () => undefined,
    operatorTimeoutMs: 10_000,
    ...overrides,
  } as unknown as V213V209ChromeOperatorInput;
}

function shortDeadlineInput(
  directory: string,
  browser: ReturnType<typeof fakeBrowser>,
  budgetMs = 80,
) {
  const startedAt = Date.now();
  const input = testInput(
    directory,
    browser,
    { now: () => new Date() },
    {
      terminalAt: new Date(startedAt - 1_000).toISOString(),
      deadlineAt: new Date(startedAt + budgetMs).toISOString(),
    },
  );
  return { input, startedAt };
}

describe("V2-09 real Chrome operator", () => {
  it("matches the externally sealed helper source pins", async () => {
    const { verifyV213V209ChromeOperatorSources } = await import("./v213-real-chrome-operator.js");
    expect(verifyV213V209ChromeOperatorSources(V213_V209_CHROME_OPERATOR_SOURCE_PINS)).toBe(true);
  });

  it("runs a distinct release-bound read-only project/revision/playback journey", async () => {
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v213-release-chrome-run-"));
    chmodSync(directory, 0o700);
    try {
      const now = () => new Date("2026-08-27T00:00:10.000Z");
      const request = buildV213ReleaseChromeRequest(
        {
          fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
          smokeEvidenceSha256: `sha256:${"1".repeat(64)}`,
          releaseIdentitySha256: `sha256:${"2".repeat(64)}`,
          productionUrlSha256: `sha256:${"3".repeat(64)}`,
          accountId: "22222222-2222-4222-8222-222222222222",
          workspaceId: "33333333-3333-4333-8333-333333333333",
          projectId: "55555555-5555-4555-8555-555555555555",
          projectRevisionId: "66666666-6666-4666-8666-666666666666",
          outputSha256: OUTPUT_SHA256 as `sha256:${string}`,
          finalOutputReceiptSha256: OUTPUT_RECEIPT_SHA256 as `sha256:${string}`,
          attemptId: "44444444-4444-4444-8444-444444444444",
          smokeTerminalAt: "2026-08-27T00:00:00.000Z",
          deadlineAt: "2026-08-27T00:00:20.000Z",
        },
        now(),
      );
      const requestPath = join(directory, "release-request.json");
      writeFileSync(requestPath, canonicalizeJson(request as never), {
        encoding: "utf8",
        mode: 0o600,
      });
      chmodSync(requestPath, 0o600);
      const receipt = await runV213ReleaseRealChromeJourney({
        requestPath,
        productionOrigin: "https://videoforge.example",
        authStatePath: authState(directory),
        evidenceSigningKey: KEY,
        now,
        launch: fakeBrowser({}).launch as never,
      });
      expect(receipt).toMatchObject({
        schemaVersion: V213_RELEASE_CHROME_CHILD_RECEIPT_SCHEMA,
        requestSha256: request.requestSha256,
        document: {
          projectId: request.projectId,
          projectRevisionId: request.projectRevisionId,
          outputSha256: OUTPUT_SHA256,
          playbackPassed: true,
          privateProjectReadbackPassed: true,
          privateRevisionReadbackPassed: true,
          downloadPassed: true,
        },
      });
      expect(receipt.signatureHex).toMatch(/^[0-9a-f]{64}$/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses installed Chrome, binds authenticated scope/output, proves playback/download, and writes a private receipt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-operator-"));
    chmodSync(directory, 0o700);
    try {
      const browser = fakeBrowser({
        launcher: (options) => {
          expect(options).toEqual({ channel: "chrome", headless: false });
        },
      });
      const result = await runV213V209RealChromeOperator(testInput(directory, browser));
      expect(result.browser).toBe("REAL_CHROME");
      expect(result.durationSeconds).toBe(40);
      expect(browser.launch).toHaveBeenCalledOnce();
      const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
      expect(receipt.schemaVersion).toBe(V213_V209_CHROME_RECEIPT_SCHEMA);
      expect(receipt.document.schemaVersion).toBe(V213_V209_CHROME_EVIDENCE_SCHEMA);
      expect(receipt.document.browser).toBe("REAL_CHROME");
      expect(receipt.document.playbackAccepted).toBe(true);
      expect(receipt.document.downloadAccepted).toBe(true);
      expect(receipt.document.finalOutputSha256).toBe(OUTPUT_SHA256);
      expect(receipt.document.finalOutputReceiptSha256).toBe(OUTPUT_RECEIPT_SHA256);
      expect(statSync(result.receiptPath).mode & 0o7777).toBe(0o600);
      expect(JSON.stringify(receipt)).not.toContain(Buffer.from(KEY).toString("base64"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    [
      "ambiguous output",
      { outputs: undefined, extra: true },
      "V209_CHROME_LIBRARY_OUTPUT_AMBIGUOUS",
    ],
    [
      "wrong tenant",
      {
        tenant: {
          schema_version: "videoforge-hosted-tenant/v1",
          account_id: "other",
          workspace_id: "33333333-3333-4333-8333-333333333333",
        },
      },
      "V209_CHROME_TENANT_SCOPE_INVALID",
    ],
    [
      "wrong hash",
      { outputs: [{ checksum_sha256: `sha256:${"c".repeat(64)}` }] },
      "V209_CHROME_LIBRARY_OUTPUT_NOT_FOUND",
    ],
    ["wrong duration", { durationSeconds: 29 }, "V209_CHROME_PLAYBACK_DURATION_INVALID"],
  ] as const)("fails closed on %s", async (_name, options, code) => {
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-operator-negative-"));
    chmodSync(directory, 0o700);
    try {
      const browser = fakeBrowser(
        "extra" in options && options.extra
          ? {
              outputs: [
                {
                  attempt_id: "44444444-4444-4444-8444-444444444444",
                  project_id: "55555555-5555-4555-8555-555555555555",
                  title: "one",
                  created_at: "2026-08-26T23:59:00.000Z",
                  content_length: OUTPUT_BYTES.length,
                  checksum_sha256: OUTPUT_SHA256,
                  download_url: "https://r2.example.test/one",
                  download_expires_at: "2026-08-27T00:00:15.000Z",
                },
                {
                  attempt_id: "66666666-6666-4666-8666-666666666666",
                  project_id: "77777777-7777-4777-8777-777777777777",
                  title: "two",
                  created_at: "2026-08-26T23:59:00.000Z",
                  content_length: OUTPUT_BYTES.length,
                  checksum_sha256: OUTPUT_SHA256,
                  download_url: "https://r2.example.test/two",
                  download_expires_at: "2026-08-27T00:00:15.000Z",
                },
              ],
            }
          : options,
      );
      await expect(
        runV213V209RealChromeOperator(testInput(directory, browser)),
      ).rejects.toMatchObject({ code });
      expect(() =>
        readFileSync(
          join(directory, "hosted-pair-11111111-1111-4111-8111-111111111111.receipt.json"),
        ),
      ).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects auth-state permission drift before launching Chrome", async () => {
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-operator-auth-"));
    chmodSync(directory, 0o700);
    try {
      const browser = fakeBrowser({});
      const input = testInput(directory, browser);
      chmodSync(input.authStatePath, 0o644);
      await expect(runV213V209RealChromeOperator(input)).rejects.toMatchObject({
        code: "V209_CHROME_AUTH_STATE_MODE_INVALID",
      });
      expect(browser.launch).not.toHaveBeenCalled();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an observed time before terminal output and does not publish a receipt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-operator-time-"));
    chmodSync(directory, 0o700);
    try {
      const browser = fakeBrowser({});
      const input = testInput(directory, browser, {
        now: () => new Date("2026-08-26T23:59:59.000Z"),
      });
      await expect(runV213V209RealChromeOperator(input)).rejects.toMatchObject({
        code: "V209_CHROME_REQUEST_INVALID",
      });
      expect(browser.launch).not.toHaveBeenCalled();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["navigation", { gotoNever: true }, "V209_CHROME_NAVIGATION_DEADLINE_EXCEEDED"],
    ["API fetch", { evaluateNever: true }, "V209_CHROME_API_DEADLINE_EXCEEDED"],
    ["media playback", { playbackNever: true }, "V209_CHROME_PLAYBACK_DEADLINE_EXCEEDED"],
    ["download", { downloadNever: true }, "V209_CHROME_DOWNLOAD_DEADLINE_EXCEEDED"],
  ] as const)("bounds %s by the absolute request deadline", async (_name, behavior, code) => {
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-operator-deadline-"));
    chmodSync(directory, 0o700);
    try {
      const browser = fakeBrowser(behavior);
      const { input, startedAt } = shortDeadlineInput(directory, browser);
      await expect(runV213V209RealChromeOperator(input)).rejects.toMatchObject({ code });
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("passes the signing key only through inherited fd 3 and never argv/environment", async () => {
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-operator-spawn-"));
    chmodSync(directory, 0o700);
    try {
      const { requestPath } = requestFor(directory, {
        terminalAt: new Date(Date.now() - 1_000).toISOString(),
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const authStatePath = authState(directory);
      const pipe = new PassThrough();
      const chunks: Buffer[] = [];
      pipe.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      const child = Object.assign(new EventEmitter(), {
        stdio: [null, null, null, pipe],
        kill: vi.fn(),
      });
      let args: readonly string[] = [];
      let environment: NodeJS.ProcessEnv = {};
      const fakeSpawn = vi.fn(
        (_command: string, childArgs: readonly string[], options: { env: NodeJS.ProcessEnv }) => {
          args = childArgs;
          environment = options.env;
          setImmediate(() => child.emit("exit", 0, null));
          return child;
        },
      );
      const digest = (path: string) =>
        `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
      await expect(
        spawnV213V209ChromeOperator({
          requestPath,
          exchangeDirectory: directory,
          productionOrigin: "https://videoforge.example",
          authStatePath,
          evidenceSigningKey: KEY,
          sourcePins: {
            moduleSha256: digest(resolve("src/server/providers/v213-real-chrome-operator.ts")),
            entrySha256: digest(resolve("src/server/providers/v213-real-chrome-operator-main.ts")),
          },
          spawn: fakeSpawn as never,
        }),
      ).resolves.toBeUndefined();
      expect(fakeSpawn).toHaveBeenCalledOnce();
      expect(JSON.stringify(args)).not.toContain(Buffer.from(KEY).toString("base64"));
      expect(JSON.stringify(environment)).not.toContain(Buffer.from(KEY).toString("base64"));
      expect(Buffer.concat(chunks)).toEqual(Buffer.from(KEY));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves the exact protected child failure code, including inner deadline errors", async () => {
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-operator-child-error-"));
    chmodSync(directory, 0o700);
    try {
      const { requestPath } = requestFor(directory, {
        terminalAt: new Date(Date.now() - 1_000).toISOString(),
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const authStatePath = authState(directory);
      const keyPipe = new PassThrough();
      const stderr = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdio: [null, null, stderr, keyPipe],
        kill: vi.fn(),
      });
      const fakeSpawn = vi.fn(() => {
        setImmediate(() => {
          stderr.write("V209_CHROME_API_DEADLINE_EXCEEDED\n");
          child.emit("exit", 1, null);
        });
        return child;
      });
      const digest = (path: string) =>
        `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
      await expect(
        spawnV213V209ChromeOperator({
          requestPath,
          exchangeDirectory: directory,
          productionOrigin: "https://videoforge.example",
          authStatePath,
          evidenceSigningKey: KEY,
          sourcePins: {
            moduleSha256: digest(resolve("src/server/providers/v213-real-chrome-operator.ts")),
            entrySha256: digest(resolve("src/server/providers/v213-real-chrome-operator-main.ts")),
          },
          spawn: fakeSpawn as never,
        }),
      ).rejects.toMatchObject({ code: "V209_CHROME_API_DEADLINE_EXCEEDED" });
      expect(child.kill).not.toHaveBeenCalled();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("kills a child at the exact deadline without a grace extension", async () => {
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-operator-watchdog-"));
    chmodSync(directory, 0o700);
    try {
      const startedAt = Date.now();
      const { requestPath } = requestFor(directory, {
        terminalAt: new Date(startedAt - 1_000).toISOString(),
        deadlineAt: new Date(startedAt + 80).toISOString(),
      });
      const authStatePath = authState(directory);
      const pipe = new PassThrough();
      const child = Object.assign(new EventEmitter(), {
        stdio: [null, null, null, pipe],
        kill: vi.fn(),
      });
      const fakeSpawn = vi.fn(() => child);
      const digest = (path: string) =>
        `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
      await expect(
        spawnV213V209ChromeOperator({
          requestPath,
          exchangeDirectory: directory,
          productionOrigin: "https://videoforge.example",
          authStatePath,
          evidenceSigningKey: KEY,
          sourcePins: {
            moduleSha256: digest(resolve("src/server/providers/v213-real-chrome-operator.ts")),
            entrySha256: digest(resolve("src/server/providers/v213-real-chrome-operator-main.ts")),
          },
          spawn: fakeSpawn as never,
        }),
      ).rejects.toMatchObject({ code: "V209_CHROME_OPERATOR_DEADLINE_EXCEEDED" });
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

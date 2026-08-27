import { spawn as spawnProcess } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";
import { canonicalSha256 } from "@videoforge/control-plane";

import { v213EvidenceKeyId } from "../hosted/v213-live-production-adapters.js";
import {
  V213_RELEASE_CHROME_CHILD_RECEIPT_SCHEMA,
  V213_RELEASE_CHROME_OBSERVATION_SCHEMA,
  validateV213ReleaseChromeRequest,
  type SpawnV213ReleaseChromeJourney,
  type V213ReleaseChromeChildReceipt,
  type V213ReleaseChromeObservation,
  type V213ReleaseChromeRequest,
} from "./v213-release-real-chrome.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const REQUEST_SCHEMA = "videoforge.v2-09-real-chrome-request/v1" as const;
const RECEIPT_SCHEMA = "videoforge.v2-09-real-chrome-receipt/v1" as const;
const EVIDENCE_SCHEMA = "videoforge.v2-09-real-chrome-acceptance/v1" as const;
const LIBRARY_SCHEMA = "videoforge-hosted-library/v1" as const;
const OPERATOR_POLL_INTERVAL_MS = 500;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_PROTECTED_KEY_BYTES = 256 * 1024;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CHILD_ERROR_BYTES = 4 * 1024;
const CHILD_ERROR_CODE = /^V209_CHROME_[A-Z0-9_]+$/u;
const RELEASE_CHILD_ERROR_CODE = /^V213_RELEASE_CHROME_[A-Z0-9_]+$/u;

const REQUEST_KEYS = Object.freeze([
  "accountId",
  "deadlineAt",
  "finalOutputReceiptSha256",
  "finalOutputSha256",
  "generationRequestId",
  "requestSha256",
  "schemaVersion",
  "terminalAt",
  "workflowId",
  "workspaceId",
]);

const UNSIGNED_REQUEST_KEYS = Object.freeze(REQUEST_KEYS.filter((key) => key !== "requestSha256"));

const EVIDENCE_KEYS = Object.freeze([
  "accountId",
  "browser",
  "downloadAccepted",
  "durationSeconds",
  "finalOutputReceiptSha256",
  "finalOutputSha256",
  "generationRequestId",
  "observedAt",
  "playbackAccepted",
  "schemaVersion",
  "terminalAt",
  "workflowId",
  "workspaceId",
]);

const RECEIPT_KEYS = Object.freeze([
  "artifactSha256",
  "document",
  "keyId",
  "kind",
  "requestSha256",
  "schemaVersion",
  "signatureHex",
]);

export const V213_V209_CHROME_REQUEST_SCHEMA = REQUEST_SCHEMA;
export const V213_V209_CHROME_RECEIPT_SCHEMA = RECEIPT_SCHEMA;
export const V213_V209_CHROME_EVIDENCE_SCHEMA = EVIDENCE_SCHEMA;
export const V213_V209_CHROME_EXCHANGE_DIRECTORY_ENV =
  "VIDEOFORGE_V209_CHROME_EVIDENCE_DIR" as const;
export const V213_V209_CHROME_AUTH_STATE_ENV = "VIDEOFORGE_V209_CHROME_AUTH_STATE_FILE" as const;
export const V213_V209_CHROME_ORIGIN_ENV = "VIDEOFORGE_V209_CHROME_ORIGIN" as const;
export const V213_V209_CHROME_REQUEST_ENV = "VIDEOFORGE_V209_CHROME_REQUEST_PATH" as const;
export const V213_V209_CHROME_KEY_FD = 3 as const;

export class V213V209ChromeOperatorError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "V213V209ChromeOperatorError";
  }
}

function fail(code: string): never {
  throw new V213V209ChromeOperatorError(code);
}

function sha256Bytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Json(value: JsonValue): `sha256:${string}` {
  return sha256Bytes(Buffer.from(canonicalizeJson(value), "utf8"));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function assertAbsolutePath(value: string, code: string): string {
  if (typeof value !== "string" || value === "" || value.includes("\0")) fail(code);
  const absolute = resolve(value);
  if (absolute !== value) fail(code);
  return absolute;
}

function assertMode(path: string, mode: number, code: string): void {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    fail(code);
  }
  if ((stat.mode & 0o7777) !== mode) fail(code);
}

function assertPrivateDirectory(path: string): string {
  const absolute = assertAbsolutePath(path, "V209_CHROME_EXCHANGE_DIRECTORY_INVALID");
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(absolute);
  } catch {
    fail("V209_CHROME_EXCHANGE_DIRECTORY_UNAVAILABLE");
  }
  if (!stat.isDirectory() || (stat.mode & 0o7777) !== 0o700)
    fail("V209_CHROME_EXCHANGE_DIRECTORY_MODE_INVALID");
  return absolute;
}

function assertPrivateFile(path: string, code: string): string {
  const absolute = assertAbsolutePath(path, code);
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(absolute);
  } catch {
    fail(code);
  }
  if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600) fail(code);
  return absolute;
}

function parseJsonBytes(bytes: Buffer, code: string, maxBytes: number): Record<string, unknown> {
  if (bytes.length === 0 || bytes.length > maxBytes) fail(code);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(code);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
}

function remainingMilliseconds(
  deadlineAt: number,
  now: () => Date,
  code = "V209_CHROME_DEADLINE_EXCEEDED",
): number {
  const remaining = deadlineAt - now().getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) fail(code);
  return Math.floor(remaining);
}

/**
 * Every asynchronous browser/filesystem operation is raced against the same absolute request
 * deadline. The operation itself is still allowed to settle in the background, but the operator
 * never waits for it after the deadline and the finally block closes the browser context.
 */
async function withDeadline<T>(
  operation: () => Promise<T>,
  deadlineAt: number,
  now: () => Date,
  code = "V209_CHROME_DEADLINE_EXCEEDED",
): Promise<T> {
  const timeoutMs = remainingMilliseconds(deadlineAt, now, code);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operationPromise = Promise.resolve().then(operation);
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new V213V209ChromeOperatorError(code)), timeoutMs);
  });
  try {
    const result = await Promise.race([operationPromise, timeoutPromise]);
    if (now().getTime() > deadlineAt) fail(code);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function parseRequest(path: string, now: () => Date): V213V209ChromeRequest {
  const requestPath = assertPrivateFile(path, "V209_CHROME_REQUEST_MODE_INVALID");
  const bytes = readFileSync(requestPath);
  const value = parseJsonBytes(bytes, "V209_CHROME_REQUEST_JSON_INVALID", MAX_REQUEST_BYTES);
  if (!exactKeys(value, REQUEST_KEYS)) fail("V209_CHROME_REQUEST_FIELDS_INVALID");
  if (canonicalizeJson(value as JsonValue) !== bytes.toString("utf8"))
    fail("V209_CHROME_REQUEST_NOT_CANONICAL");
  const unsigned = Object.fromEntries(
    UNSIGNED_REQUEST_KEYS.map((key) => [key, value[key]]),
  ) as JsonValue;
  const terminalAt = typeof value.terminalAt === "string" ? Date.parse(value.terminalAt) : NaN;
  const deadlineAt = typeof value.deadlineAt === "string" ? Date.parse(value.deadlineAt) : NaN;
  const current = now().getTime();
  if (
    value.schemaVersion !== REQUEST_SCHEMA ||
    !validIdentifier(value.workflowId) ||
    !validIdentifier(value.accountId) ||
    !validIdentifier(value.workspaceId) ||
    !validIdentifier(value.generationRequestId) ||
    value.workflowId !== `hosted-pair-${value.generationRequestId}` ||
    !SHA256.test(String(value.finalOutputSha256)) ||
    !SHA256.test(String(value.finalOutputReceiptSha256)) ||
    !SHA256.test(String(value.requestSha256)) ||
    sha256Json(unsigned) !== value.requestSha256 ||
    !Number.isFinite(terminalAt) ||
    !Number.isFinite(deadlineAt) ||
    terminalAt > current ||
    deadlineAt <= current ||
    terminalAt > deadlineAt
  )
    fail("V209_CHROME_REQUEST_INVALID");
  const stem = value.workflowId.replace(/[^A-Za-z0-9._-]/gu, "_");
  if (basename(requestPath) !== `${stem}.request.json`)
    fail("V209_CHROME_REQUEST_PATH_BINDING_INVALID");
  return Object.freeze(value as unknown as V213V209ChromeRequest);
}

export interface V213V209ChromeRequest {
  readonly schemaVersion: typeof REQUEST_SCHEMA;
  readonly workflowId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly generationRequestId: string;
  readonly finalOutputSha256: `sha256:${string}`;
  readonly finalOutputReceiptSha256: `sha256:${string}`;
  readonly terminalAt: string;
  readonly deadlineAt: string;
  readonly requestSha256: `sha256:${string}`;
}

export interface V213V209ChromeEvidenceDocument {
  readonly schemaVersion: typeof EVIDENCE_SCHEMA;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly generationRequestId: string;
  readonly workflowId: string;
  readonly finalOutputSha256: `sha256:${string}`;
  readonly finalOutputReceiptSha256: `sha256:${string}`;
  readonly terminalAt: string;
  readonly browser: "REAL_CHROME";
  readonly playbackAccepted: true;
  readonly downloadAccepted: true;
  readonly durationSeconds: number;
  readonly observedAt: string;
}

export interface V213V209ChromeReceipt {
  readonly schemaVersion: typeof RECEIPT_SCHEMA;
  readonly kind: "CHROME";
  readonly requestSha256: `sha256:${string}`;
  readonly artifactSha256: `sha256:${string}`;
  readonly keyId: string;
  readonly signatureHex: string;
  readonly document: V213V209ChromeEvidenceDocument;
}

interface V213V209LibraryOutput {
  readonly attempt_id: string;
  readonly project_id: string;
  readonly title: string;
  readonly created_at: string;
  readonly content_length: number;
  readonly checksum_sha256: `sha256:${string}`;
  readonly download_url: string;
  readonly download_expires_at: string;
}

interface V213V209ChromeLocator {
  count(): Promise<number>;
  nth(index: number): V213V209ChromeLocator;
  getAttribute(name: string): Promise<string | null>;
  evaluate<T>(
    callback: (element: unknown, argument?: unknown) => T | Promise<T>,
    argument?: unknown,
  ): Promise<T>;
  click(options?: Readonly<Record<string, unknown>>): Promise<void>;
}

interface V213V209ChromeDownload {
  path(): Promise<string | null>;
  failure(): Promise<string | null>;
  delete(): Promise<void>;
}

interface V213V209ChromePage {
  goto(url: string, options?: Readonly<Record<string, unknown>>): Promise<unknown>;
  evaluate<T>(callback: (argument?: unknown) => T | Promise<T>, argument?: unknown): Promise<T>;
  locator(selector: string): V213V209ChromeLocator;
  waitForEvent(
    name: "download",
    options?: Readonly<Record<string, unknown>>,
  ): Promise<V213V209ChromeDownload>;
  close(): Promise<void>;
}

interface V213V209ChromeContext {
  route(
    url: string,
    handler: (route: {
      request(): { method(): string };
      continue(): Promise<void>;
      abort(errorCode?: string): Promise<void>;
    }) => Promise<void>,
  ): Promise<void>;
  newPage(): Promise<V213V209ChromePage>;
  close(): Promise<void>;
}

interface V213V209ChromeBrowser {
  newContext(options: {
    readonly storageState: string;
    readonly acceptDownloads: true;
    readonly baseURL: string;
  }): Promise<V213V209ChromeContext>;
  close(): Promise<void>;
}

type LaunchInstalledChrome = (options: {
  readonly channel: "chrome";
  readonly headless: false;
}) => Promise<V213V209ChromeBrowser>;

const launchInstalledChrome: LaunchInstalledChrome = async (options) =>
  (await chromium.launch(options)) as unknown as V213V209ChromeBrowser;

const V213_V209_CHROME_OPERATOR_MODULE_URL = new URL(
  "./v213-real-chrome-operator.ts",
  import.meta.url,
);
const V213_V209_CHROME_OPERATOR_ENTRY_URL = new URL(
  "./v213-real-chrome-operator-main.ts",
  import.meta.url,
);

function sourcePath(url: URL, fallbackRelativePath: string): string {
  try {
    if (url.protocol === "file:") return fileURLToPath(url);
    const candidates = [
      resolve(process.cwd(), fallbackRelativePath),
      resolve(process.cwd(), "apps/web", fallbackRelativePath),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) fail("V209_CHROME_OPERATOR_SOURCE_UNAVAILABLE");
    return path;
  } catch {
    fail("V209_CHROME_OPERATOR_SOURCE_UNAVAILABLE");
  }
}

function sourceSha256(url: URL, fallbackRelativePath: string): string {
  return sha256Bytes(readFileSync(sourcePath(url, fallbackRelativePath)));
}

export function verifyV213V209ChromeOperatorSources(expected: {
  readonly moduleSha256: string;
  readonly entrySha256: string;
}): boolean {
  try {
    const moduleSha256 = sourceSha256(
      V213_V209_CHROME_OPERATOR_MODULE_URL,
      "src/server/providers/v213-real-chrome-operator.ts",
    );
    const entrySha256 = sourceSha256(
      V213_V209_CHROME_OPERATOR_ENTRY_URL,
      "src/server/providers/v213-real-chrome-operator-main.ts",
    );
    return moduleSha256 === expected.moduleSha256 && entrySha256 === expected.entrySha256;
  } catch {
    return false;
  }
}

export interface V213V209ChromeOperatorInput {
  readonly requestPath: string;
  readonly exchangeDirectory: string;
  readonly productionOrigin: string;
  readonly authStatePath: string;
  /** Test-only seam. Production entrypoints use keyFd and never pass key bytes through argv/env. */
  readonly evidenceSigningKey?: Uint8Array;
  readonly evidenceSigningKeyFd?: number;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly launch?: LaunchInstalledChrome;
  readonly operatorTimeoutMs?: number;
}

export interface V213V209ChromeOperatorResult {
  readonly schemaVersion: "videoforge.v2-09-real-chrome-operator-result/v1";
  readonly requestPath: string;
  readonly receiptPath: string;
  readonly artifactSha256: `sha256:${string}`;
  readonly durationSeconds: number;
  readonly observedAt: string;
  readonly browser: "REAL_CHROME";
}

export interface V213V209ChromeOperatorSpawnInput {
  readonly requestPath: string;
  readonly exchangeDirectory: string;
  readonly productionOrigin: string;
  readonly authStatePath: string;
  readonly evidenceSigningKey: Uint8Array;
  readonly sourcePins: {
    readonly moduleSha256: string;
    readonly entrySha256: string;
  };
  readonly signal?: AbortSignal;
  readonly spawn?: typeof spawnProcess;
}

function protectedChildErrorCode(
  chunks: readonly Buffer[],
  totalBytes: number,
): string | undefined {
  if (totalBytes === 0 || totalBytes > MAX_CHILD_ERROR_BYTES) return undefined;
  const value = Buffer.concat(chunks, totalBytes).toString("utf8").trim();
  return CHILD_ERROR_CODE.test(value) ? value : undefined;
}

/**
 * Launch the operator as a separate process after the bridge has atomically written its request.
 * The acceptance key is sent only through inherited fd 3 and is not present in argv, environment,
 * stdout, or stderr. The source and entrypoint are checked before the child is created.
 */
export async function spawnV213V209ChromeOperator(
  input: V213V209ChromeOperatorSpawnInput,
): Promise<void> {
  if (!verifyV213V209ChromeOperatorSources(input.sourcePins))
    fail("V209_CHROME_OPERATOR_SOURCE_DRIFT");
  if (input.evidenceSigningKey.byteLength < 32) fail("V209_CHROME_SIGNING_KEY_INVALID");
  const request = readV213V209ChromeRequest(input.requestPath);
  const deadlineAt = Date.parse(request.deadlineAt);
  const remainingMs = deadlineAt - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) fail("V209_CHROME_DEADLINE_EXPIRED");
  const executable = sourcePath(
    V213_V209_CHROME_OPERATOR_ENTRY_URL,
    "src/server/providers/v213-real-chrome-operator-main.ts",
  );
  if (input.signal?.aborted) fail("V209_CHROME_OPERATOR_DEADLINE_EXCEEDED");
  const safeEnvironment: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "PLAYWRIGHT_BROWSERS_PATH"]) {
    const value = process.env[name];
    if (value !== undefined) safeEnvironment[name] = value;
  }
  const child = (input.spawn ?? spawnProcess)(
    process.execPath,
    [
      ...process.execArgv,
      executable,
      "--request",
      input.requestPath,
      "--exchange",
      input.exchangeDirectory,
      "--origin",
      input.productionOrigin,
      "--auth-state",
      input.authStatePath,
    ],
    {
      env: safeEnvironment,
      stdio: ["ignore", "ignore", "pipe", "pipe"],
    },
  );
  const stderrPipe = child.stdio[2] as unknown as {
    on(event: "data", listener: (chunk: Uint8Array | string) => void): void;
  } | null;
  const stderrChunks: Buffer[] = [];
  let stderrBytes = 0;
  if (stderrPipe && typeof stderrPipe.on === "function") {
    stderrPipe.on("data", (chunk) => {
      const bytes = Buffer.from(chunk);
      if (stderrBytes <= MAX_CHILD_ERROR_BYTES) {
        stderrChunks.push(bytes);
        stderrBytes += bytes.length;
      }
    });
  }
  const keyPipe = child.stdio[3] as unknown as {
    write(chunk: Uint8Array): boolean;
    end(): void;
  } | null;
  if (!keyPipe || typeof keyPipe.write !== "function" || typeof keyPipe.end !== "function") {
    child.kill("SIGKILL");
    fail("V209_CHROME_SIGNING_KEY_PIPE_UNAVAILABLE");
  }
  const remainingBeforeKeyWrite = deadlineAt - Date.now();
  if (!Number.isFinite(remainingBeforeKeyWrite) || remainingBeforeKeyWrite <= 0) {
    child.kill("SIGKILL");
    fail("V209_CHROME_DEADLINE_EXCEEDED");
  }
  try {
    keyPipe.write(Buffer.from(input.evidenceSigningKey));
    keyPipe.end();
  } catch (error) {
    child.kill("SIGKILL");
    if (error instanceof V213V209ChromeOperatorError) throw error;
    fail("V209_CHROME_SIGNING_KEY_PIPE_FAILED");
  }
  const remainingAfterKeyWrite = deadlineAt - Date.now();
  if (!Number.isFinite(remainingAfterKeyWrite) || remainingAfterKeyWrite <= 0) {
    child.kill("SIGKILL");
    fail("V209_CHROME_DEADLINE_EXCEEDED");
  }
  await new Promise<void>((resolvePromise, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abortChild);
      if (error) reject(error);
      else resolvePromise();
    };
    const abortChild = () => {
      child.kill("SIGKILL");
      finish(new V213V209ChromeOperatorError("V209_CHROME_OPERATOR_DEADLINE_EXCEEDED"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new V213V209ChromeOperatorError("V209_CHROME_OPERATOR_DEADLINE_EXCEEDED"));
    }, remainingAfterKeyWrite);
    if (input.signal?.aborted) {
      abortChild();
      return;
    }
    input.signal?.addEventListener("abort", abortChild, { once: true });
    child.once("error", (error) => {
      const childCode = (error as { code?: unknown }).code;
      if (typeof childCode === "string" && CHILD_ERROR_CODE.test(childCode))
        finish(new V213V209ChromeOperatorError(childCode));
      else finish(new V213V209ChromeOperatorError("V209_CHROME_OPERATOR_FAILED"));
    });
    child.once("exit", (code) => {
      const childCode = protectedChildErrorCode(stderrChunks, stderrBytes);
      if (childCode) finish(new V213V209ChromeOperatorError(childCode));
      else if (code === 0 && Date.now() < deadlineAt) finish();
      else if (Date.now() >= deadlineAt)
        finish(new V213V209ChromeOperatorError("V209_CHROME_OPERATOR_DEADLINE_EXCEEDED"));
      else finish(new V213V209ChromeOperatorError("V209_CHROME_OPERATOR_FAILED"));
    });
  });
}

function exactProductionOrigin(value: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.includes("\0"))
    fail("V209_CHROME_ORIGIN_INVALID");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail("V209_CHROME_ORIGIN_INVALID");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== value ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  )
    fail("V209_CHROME_ORIGIN_INVALID");
  return parsed.origin;
}

function readEvidenceKey(input: V213V209ChromeOperatorInput): Uint8Array {
  if (input.evidenceSigningKey !== undefined) {
    if (input.evidenceSigningKey.byteLength < 32) fail("V209_CHROME_SIGNING_KEY_INVALID");
    return Uint8Array.from(input.evidenceSigningKey);
  }
  const fd = input.evidenceSigningKeyFd;
  if (!Number.isInteger(fd) || fd === 0 || fd === 1 || fd === 2 || fd! < 0)
    fail("V209_CHROME_SIGNING_KEY_FD_INVALID");
  let bytes: Buffer;
  try {
    bytes = readFileSync(fd!);
  } catch {
    fail("V209_CHROME_SIGNING_KEY_READ_FAILED");
  }
  if (bytes.length < 32 || bytes.length > MAX_PROTECTED_KEY_BYTES)
    fail("V209_CHROME_SIGNING_KEY_INVALID");
  return Uint8Array.from(bytes);
}

function validateProtectedAuthState(path: string): string {
  const absolute = assertPrivateFile(path, "V209_CHROME_AUTH_STATE_MODE_INVALID");
  assertMode(dirname(absolute), 0o700, "V209_CHROME_AUTH_STATE_DIRECTORY_MODE_INVALID");
  const bytes = readFileSync(absolute);
  const value = parseJsonBytes(bytes, "V209_CHROME_AUTH_STATE_INVALID", MAX_PROTECTED_KEY_BYTES);
  if (
    !Array.isArray(value.cookies) ||
    !Array.isArray(value.origins) ||
    !Object.keys(value).every((key) => key === "cookies" || key === "origins")
  )
    fail("V209_CHROME_AUTH_STATE_INVALID");
  return absolute;
}

async function readPageJson(
  page: V213V209ChromePage,
  path: string,
  deadlineAt: number,
  now: () => Date,
): Promise<Record<string, unknown>> {
  const result = await withDeadline(
    () =>
      page.evaluate(
        async (argument) => {
          const request = argument as { requestPath?: unknown; deadlineAt?: unknown };
          if (
            argument === null ||
            typeof argument !== "object" ||
            typeof request.requestPath !== "string" ||
            typeof request.deadlineAt !== "number"
          )
            throw new Error("request path/deadline missing");
          const controller = new AbortController();
          const remaining = request.deadlineAt - Date.now();
          if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("deadline expired");
          const timer = setTimeout(() => controller.abort(), Math.floor(remaining));
          try {
            const response = await fetch(request.requestPath, {
              headers: { accept: "application/json" },
              signal: controller.signal,
            });
            return { status: response.status, body: await response.text() };
          } finally {
            clearTimeout(timer);
          }
        },
        { requestPath: path, deadlineAt },
      ),
    deadlineAt,
    now,
    "V209_CHROME_API_DEADLINE_EXCEEDED",
  );
  if (result.status !== 200 || typeof result.body !== "string") fail("V209_CHROME_API_UNAVAILABLE");
  return parseJsonBytes(
    Buffer.from(result.body, "utf8"),
    "V209_CHROME_API_JSON_INVALID",
    MAX_REQUEST_BYTES,
  );
}

function parseTenant(value: Record<string, unknown>, request: V213V209ChromeRequest): void {
  if (
    value.schema_version !== "videoforge-hosted-tenant/v1" ||
    value.account_id !== request.accountId ||
    value.workspace_id !== request.workspaceId
  )
    fail("V209_CHROME_TENANT_SCOPE_INVALID");
}

function parseReleaseProjectDetail(
  value: Record<string, unknown>,
  request: V213ReleaseChromeRequest,
): void {
  const project = value.project;
  const attempts = value.attempts;
  if (!project || typeof project !== "object" || Array.isArray(project) || !Array.isArray(attempts))
    fail("V213_RELEASE_CHROME_PROJECT_READBACK_INVALID");
  const projectRecord = project as Record<string, unknown>;
  const attemptMatches = attempts.filter(
    (candidate): candidate is Record<string, unknown> =>
      candidate !== null &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      candidate.id === request.attemptId &&
      candidate.kind === "RENDER" &&
      candidate.state === "SUCCEEDED" &&
      candidate.output_checksum_sha256 === request.outputSha256,
  );
  if (
    projectRecord.id !== request.projectId ||
    projectRecord.revision_id !== request.projectRevisionId ||
    attemptMatches.length !== 1
  )
    fail("V213_RELEASE_CHROME_PROJECT_READBACK_INVALID");
}

function parseLibrary(
  value: Record<string, unknown>,
  request: V213V209ChromeRequest,
  currentMs: number,
): V213V209LibraryOutput {
  if (value.schema_version !== LIBRARY_SCHEMA || !Array.isArray(value.outputs))
    fail("V209_CHROME_LIBRARY_INVALID");
  const matches = value.outputs.filter((candidate): candidate is Record<string, unknown> => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate))
      return false;
    return candidate.checksum_sha256 === request.finalOutputSha256;
  });
  if (matches.length === 0) fail("V209_CHROME_LIBRARY_OUTPUT_NOT_FOUND");
  if (matches.length > 1) fail("V209_CHROME_LIBRARY_OUTPUT_AMBIGUOUS");
  const output = matches[0]!;
  const keys = [
    "attempt_id",
    "checksum_sha256",
    "content_length",
    "created_at",
    "download_expires_at",
    "download_url",
    "project_id",
    "title",
  ];
  const contentLength = Number(output.content_length);
  let downloadUrl: URL;
  let expiresAt: number;
  try {
    downloadUrl = new URL(String(output.download_url));
    expiresAt = Date.parse(String(output.download_expires_at));
  } catch {
    fail("V209_CHROME_LIBRARY_OUTPUT_INVALID");
  }
  if (
    !exactKeys(output, keys) ||
    !validIdentifier(output.attempt_id) ||
    !validIdentifier(output.project_id) ||
    typeof output.title !== "string" ||
    !SHA256.test(String(output.checksum_sha256)) ||
    !Number.isSafeInteger(contentLength) ||
    contentLength < 1 ||
    contentLength > MAX_DOWNLOAD_BYTES ||
    Number.isNaN(Date.parse(String(output.created_at))) ||
    downloadUrl.protocol !== "https:" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= currentMs
  )
    fail("V209_CHROME_LIBRARY_OUTPUT_INVALID");
  return Object.freeze({
    attempt_id: output.attempt_id,
    project_id: output.project_id,
    title: output.title,
    created_at: new Date(String(output.created_at)).toISOString(),
    content_length: contentLength,
    checksum_sha256: output.checksum_sha256 as `sha256:${string}`,
    download_url: downloadUrl.toString(),
    download_expires_at: new Date(expiresAt).toISOString(),
  });
}

async function waitForRenderedLocator(
  page: V213V209ChromePage,
  selector: string,
  expectedUrl: string,
  deadline: number,
  now: () => Date,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<V213V209ChromeLocator> {
  const locator = page.locator(selector);
  while (now().getTime() <= deadline) {
    const count = await withDeadline(
      () => locator.count(),
      deadline,
      now,
      "V209_CHROME_UI_OUTPUT_DEADLINE_EXCEEDED",
    );
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      const href = await withDeadline(
        () => candidate.getAttribute("src"),
        deadline,
        now,
        "V209_CHROME_UI_OUTPUT_DEADLINE_EXCEEDED",
      );
      const source =
        href ??
        (await withDeadline(
          () => candidate.getAttribute("href"),
          deadline,
          now,
          "V209_CHROME_UI_OUTPUT_DEADLINE_EXCEEDED",
        ));
      if (source === expectedUrl) return candidate;
    }
    const remaining = remainingMilliseconds(deadline, now, "V209_CHROME_UI_OUTPUT_NOT_RENDERED");
    await withDeadline(
      () => sleep(Math.min(OPERATOR_POLL_INTERVAL_MS, remaining)),
      deadline,
      now,
      "V209_CHROME_UI_OUTPUT_NOT_RENDERED",
    );
  }
  fail("V209_CHROME_UI_OUTPUT_NOT_RENDERED");
}

async function provePlayback(
  video: V213V209ChromeLocator,
  deadlineAt: number,
  now: () => Date,
): Promise<{ readonly durationSeconds: number; readonly currentTime: number }> {
  const facts = await withDeadline(
    () =>
      video.evaluate(
        async (element, argument) => {
          const deadline =
            argument !== null &&
            typeof argument === "object" &&
            typeof (argument as { deadlineAt?: unknown }).deadlineAt === "number"
              ? (argument as { deadlineAt: number }).deadlineAt
              : NaN;
          if (!Number.isFinite(deadline)) throw new Error("playback deadline missing");
          const media = element as {
            muted: boolean;
            readyState: number;
            duration: number;
            currentTime: number;
            play(): Promise<void>;
          };
          const waitUntilDeadline = async <T>(promise: Promise<T>): Promise<T> => {
            const remaining = deadline - Date.now();
            if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("deadline expired");
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("deadline expired")),
                Math.floor(remaining),
              );
            });
            try {
              return await Promise.race([promise, timeout]);
            } finally {
              if (timer !== undefined) clearTimeout(timer);
            }
          };
          const waitForPlaybackProgress = async (): Promise<void> => {
            while (media.currentTime <= 0) {
              const remaining = deadline - Date.now();
              if (!Number.isFinite(remaining) || remaining <= 0)
                throw new Error("deadline expired");
              await new Promise<void>((resolvePromise) =>
                setTimeout(resolvePromise, Math.min(100, Math.floor(remaining))),
              );
            }
          };
          media.muted = true;
          if (media.readyState < 1) {
            while (media.readyState < 1) {
              const remaining = deadline - Date.now();
              if (!Number.isFinite(remaining) || remaining <= 0)
                throw new Error("deadline expired");
              await new Promise<void>((resolvePromise) =>
                setTimeout(resolvePromise, Math.min(100, Math.floor(remaining))),
              );
            }
          }
          await waitUntilDeadline(media.play());
          await waitForPlaybackProgress();
          return {
            durationSeconds: media.duration,
            currentTime: media.currentTime,
          };
        },
        { deadlineAt },
      ),
    deadlineAt,
    now,
    "V209_CHROME_PLAYBACK_DEADLINE_EXCEEDED",
  );
  if (
    !Number.isFinite(facts.durationSeconds) ||
    facts.durationSeconds < 30 ||
    facts.durationSeconds > 60 ||
    !Number.isFinite(facts.currentTime) ||
    facts.currentTime <= 0
  )
    fail("V209_CHROME_PLAYBACK_DURATION_INVALID");
  return facts;
}

async function proveDownload(
  page: V213V209ChromePage,
  link: V213V209ChromeLocator,
  expected: V213V209LibraryOutput,
  deadlineAt: number,
  now: () => Date,
): Promise<void> {
  let download: V213V209ChromeDownload | undefined;
  try {
    const downloadPromise = page.waitForEvent("download", {
      timeout: remainingMilliseconds(deadlineAt, now, "V209_CHROME_DOWNLOAD_DEADLINE_EXCEEDED"),
    });
    await withDeadline(
      () =>
        link.click({
          timeout: remainingMilliseconds(deadlineAt, now, "V209_CHROME_DOWNLOAD_DEADLINE_EXCEEDED"),
        }),
      deadlineAt,
      now,
      "V209_CHROME_DOWNLOAD_DEADLINE_EXCEEDED",
    );
    download = await withDeadline(
      () => downloadPromise,
      deadlineAt,
      now,
      "V209_CHROME_DOWNLOAD_DEADLINE_EXCEEDED",
    );
    const failure = await withDeadline(
      () => download!.failure(),
      deadlineAt,
      now,
      "V209_CHROME_DOWNLOAD_DEADLINE_EXCEEDED",
    );
    if (failure !== null) fail("V209_CHROME_DOWNLOAD_FAILED");
    const path = await withDeadline(
      () => download!.path(),
      deadlineAt,
      now,
      "V209_CHROME_DOWNLOAD_DEADLINE_EXCEEDED",
    );
    if (!path) fail("V209_CHROME_DOWNLOAD_PATH_UNAVAILABLE");
    const remaining = remainingMilliseconds(
      deadlineAt,
      now,
      "V209_CHROME_DOWNLOAD_DEADLINE_EXCEEDED",
    );
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), remaining);
    let bytes: Buffer;
    try {
      bytes = await withDeadline(
        () => readFileAsync(path, { signal: controller.signal }),
        deadlineAt,
        now,
        "V209_CHROME_DOWNLOAD_DEADLINE_EXCEEDED",
      );
    } finally {
      clearTimeout(abortTimer);
    }
    if (now().getTime() > deadlineAt) fail("V209_CHROME_DOWNLOAD_DEADLINE_EXCEEDED");
    if (
      bytes.length !== expected.content_length ||
      bytes.length === 0 ||
      bytes.length > MAX_DOWNLOAD_BYTES ||
      sha256Bytes(bytes) !== expected.checksum_sha256
    )
      fail("V209_CHROME_DOWNLOAD_HASH_INVALID");
  } catch (error) {
    if (error instanceof V213V209ChromeOperatorError) throw error;
    fail("V209_CHROME_DOWNLOAD_FAILED");
  } finally {
    if (download) {
      const remaining = deadlineAt - now().getTime();
      if (remaining > 0) {
        await withDeadline(
          () => download!.delete(),
          deadlineAt,
          now,
          "V209_CHROME_DOWNLOAD_DEADLINE_EXCEEDED",
        ).catch(() => undefined);
      } else {
        void download.delete().catch(() => undefined);
      }
    }
  }
}

function signReceipt(
  request: V213V209ChromeRequest,
  durationSeconds: number,
  observedAt: string,
  signingKey: Uint8Array,
): V213V209ChromeReceipt {
  const document: V213V209ChromeEvidenceDocument = Object.freeze({
    schemaVersion: EVIDENCE_SCHEMA,
    accountId: request.accountId,
    workspaceId: request.workspaceId,
    generationRequestId: request.generationRequestId,
    workflowId: request.workflowId,
    finalOutputSha256: request.finalOutputSha256,
    finalOutputReceiptSha256: request.finalOutputReceiptSha256,
    terminalAt: request.terminalAt,
    browser: "REAL_CHROME",
    playbackAccepted: true,
    downloadAccepted: true,
    durationSeconds,
    observedAt,
  });
  if (!exactKeys(document as unknown as Record<string, unknown>, EVIDENCE_KEYS))
    fail("V209_CHROME_EVIDENCE_FIELDS_INVALID");
  const artifactSha256 = sha256Json(document as unknown as JsonValue);
  const signatureHex = createHmac("sha256", Buffer.from(signingKey))
    .update(`CHROME\n${artifactSha256}\n${artifactSha256}`, "utf8")
    .digest("hex");
  const receipt: V213V209ChromeReceipt = Object.freeze({
    schemaVersion: RECEIPT_SCHEMA,
    kind: "CHROME",
    requestSha256: request.requestSha256,
    artifactSha256,
    keyId: v213EvidenceKeyId(signingKey),
    signatureHex,
    document,
  });
  if (!exactKeys(receipt as unknown as Record<string, unknown>, RECEIPT_KEYS))
    fail("V209_CHROME_RECEIPT_FIELDS_INVALID");
  return receipt;
}

function writeReceiptExclusive(path: string, receipt: V213V209ChromeReceipt): void {
  if (existsSync(path)) fail("V209_CHROME_EXCHANGE_REPLAY");
  const temporary = join(
    dirname(path),
    `.${basename(path)}.tmp-${randomBytes(12).toString("hex")}`,
  );
  const bytes = Buffer.from(canonicalizeJson(receipt as unknown as JsonValue), "utf8");
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    chmodSync(temporary, 0o600);
    if (existsSync(path)) fail("V209_CHROME_EXCHANGE_REPLAY");
    // A hard-link publish is atomic and never replaces an existing destination. The temporary
    // file is complete and fsynced before it becomes visible to the waiting bridge poller.
    linkSync(temporary, path);
    unlinkSync(temporary);
    chmodSync(path, 0o600);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(temporary);
    } catch {
      // Best effort only; the exchange directory remains private and the next run fails closed.
    }
    if (error instanceof V213V209ChromeOperatorError) throw error;
    fail("V209_CHROME_RECEIPT_WRITE_FAILED");
  }
  assertPrivateFile(path, "V209_CHROME_RECEIPT_MODE_INVALID");
}

async function installReadOnlyRouteGuard(context: V213V209ChromeContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const method = route.request().method().toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
    fail("V209_CHROME_MUTATION_ROUTE_BLOCKED");
  });
}

export async function runV213V209RealChromeOperator(
  input: V213V209ChromeOperatorInput,
): Promise<V213V209ChromeOperatorResult> {
  const now = input.now ?? (() => new Date());
  const sleep =
    input.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  const exchangeDirectory = assertPrivateDirectory(input.exchangeDirectory);
  const requestPath = assertPrivateFile(input.requestPath, "V209_CHROME_REQUEST_MODE_INVALID");
  if (dirname(requestPath) !== exchangeDirectory)
    fail("V209_CHROME_REQUEST_DIRECTORY_BINDING_INVALID");
  const request = parseRequest(requestPath, now);
  const receiptPath = join(
    exchangeDirectory,
    `${request.workflowId.replace(/[^A-Za-z0-9._-]/gu, "_")}.receipt.json`,
  );
  if (existsSync(receiptPath)) fail("V209_CHROME_EXCHANGE_REPLAY");
  const origin = exactProductionOrigin(input.productionOrigin);
  const authStatePath = validateProtectedAuthState(input.authStatePath);
  const signingKey = readEvidenceKey(input);
  const deadline = Date.parse(request.deadlineAt);
  if (!Number.isFinite(deadline) || deadline <= now().getTime())
    fail("V209_CHROME_DEADLINE_EXPIRED");
  let browser: V213V209ChromeBrowser | undefined;
  let context: V213V209ChromeContext | undefined;
  let page: V213V209ChromePage | undefined;
  try {
    const launch = input.launch ?? launchInstalledChrome;
    browser = await withDeadline(
      () => launch({ channel: "chrome", headless: false }),
      deadline,
      now,
      "V209_CHROME_LAUNCH_DEADLINE_EXCEEDED",
    );
    context = await withDeadline(
      () =>
        browser!.newContext({
          storageState: authStatePath,
          acceptDownloads: true,
          baseURL: origin,
        }),
      deadline,
      now,
      "V209_CHROME_CONTEXT_DEADLINE_EXCEEDED",
    );
    await withDeadline(
      () => installReadOnlyRouteGuard(context!),
      deadline,
      now,
      "V209_CHROME_CONTEXT_DEADLINE_EXCEEDED",
    );
    page = await withDeadline(
      () => context!.newPage(),
      deadline,
      now,
      "V209_CHROME_PAGE_DEADLINE_EXCEEDED",
    );
    await withDeadline(
      () =>
        page!.goto(`${origin}/library`, {
          waitUntil: "domcontentloaded",
          timeout: remainingMilliseconds(deadline, now, "V209_CHROME_NAVIGATION_DEADLINE_EXCEEDED"),
        }),
      deadline,
      now,
      "V209_CHROME_NAVIGATION_DEADLINE_EXCEEDED",
    );
    const tenant = await readPageJson(page, "/api/v2/tenant", deadline, now);
    parseTenant(tenant, request);
    const library = parseLibrary(
      await readPageJson(page, "/api/v2/library", deadline, now),
      request,
      now().getTime(),
    );
    const video = await waitForRenderedLocator(
      page,
      "video",
      library.download_url,
      deadline,
      now,
      sleep,
    );
    const playback = await provePlayback(video, deadline, now);
    const link = await waitForRenderedLocator(
      page,
      "a[href]",
      library.download_url,
      deadline,
      now,
      sleep,
    );
    await proveDownload(page, link, library, deadline, now);
    const observedAt = now().toISOString();
    const observedAtMs = Date.parse(observedAt);
    const terminalAtMs = Date.parse(request.terminalAt);
    if (
      !Number.isFinite(observedAtMs) ||
      !Number.isFinite(terminalAtMs) ||
      observedAtMs < terminalAtMs ||
      observedAtMs > deadline
    )
      fail("V209_CHROME_OBSERVED_TIME_INVALID");
    const receipt = signReceipt(request, playback.durationSeconds, observedAt, signingKey);
    writeReceiptExclusive(receiptPath, receipt);
    return Object.freeze({
      schemaVersion: "videoforge.v2-09-real-chrome-operator-result/v1",
      requestPath,
      receiptPath,
      artifactSha256: receipt.artifactSha256,
      durationSeconds: playback.durationSeconds,
      observedAt,
      browser: "REAL_CHROME",
    });
  } catch (error) {
    if (error instanceof V213V209ChromeOperatorError) throw error;
    return fail("V209_CHROME_OPERATOR_FAILED");
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

export interface V213ReleaseRealChromeJourneyInput {
  readonly requestPath: string;
  readonly productionOrigin: string;
  readonly authStatePath: string;
  readonly evidenceSigningKey?: Uint8Array;
  readonly evidenceSigningKeyFd?: number;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly launch?: LaunchInstalledChrome;
}

function readV213ReleaseChromeRequest(
  requestPath: string,
  now: () => Date,
): V213ReleaseChromeRequest {
  const path = assertPrivateFile(requestPath, "V213_RELEASE_CHROME_REQUEST_MODE_INVALID");
  assertMode(dirname(path), 0o700, "V213_RELEASE_CHROME_REQUEST_DIRECTORY_MODE_INVALID");
  const value = parseJsonBytes(
    readFileSync(path),
    "V213_RELEASE_CHROME_REQUEST_INVALID",
    MAX_REQUEST_BYTES,
  );
  try {
    return validateV213ReleaseChromeRequest(value, now());
  } catch {
    fail("V213_RELEASE_CHROME_REQUEST_INVALID");
  }
}

function releaseChromeEvidenceKey(input: V213ReleaseRealChromeJourneyInput): Uint8Array {
  return readEvidenceKey({
    requestPath: input.requestPath,
    exchangeDirectory: dirname(input.requestPath),
    productionOrigin: input.productionOrigin,
    authStatePath: input.authStatePath,
    evidenceSigningKey: input.evidenceSigningKey,
    evidenceSigningKeyFd: input.evidenceSigningKeyFd,
  });
}

/** The distinct V2-13 journey reuses only the installed-Chrome/read-only browser primitives. Its
 * request, observation, child receipt, and final artifact schemas are separate from V2-09. */
export async function runV213ReleaseRealChromeJourney(
  input: V213ReleaseRealChromeJourneyInput,
): Promise<V213ReleaseChromeChildReceipt> {
  const now = input.now ?? (() => new Date());
  const sleep =
    input.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  const request = readV213ReleaseChromeRequest(input.requestPath, now);
  if (request.attemptId === null) fail("V213_RELEASE_CHROME_ATTEMPT_REQUIRED");
  const origin = exactProductionOrigin(input.productionOrigin);
  const authStatePath = validateProtectedAuthState(input.authStatePath);
  const signingKey = releaseChromeEvidenceKey(input);
  const deadline = Date.parse(request.deadlineAt);
  let browser: V213V209ChromeBrowser | undefined;
  let context: V213V209ChromeContext | undefined;
  let page: V213V209ChromePage | undefined;
  try {
    const launch = input.launch ?? launchInstalledChrome;
    browser = await withDeadline(
      () => launch({ channel: "chrome", headless: false }),
      deadline,
      now,
      "V213_RELEASE_CHROME_LAUNCH_DEADLINE_EXCEEDED",
    );
    context = await withDeadline(
      () =>
        browser!.newContext({
          storageState: authStatePath,
          acceptDownloads: true,
          baseURL: origin,
        }),
      deadline,
      now,
      "V213_RELEASE_CHROME_CONTEXT_DEADLINE_EXCEEDED",
    );
    await withDeadline(
      () => installReadOnlyRouteGuard(context!),
      deadline,
      now,
      "V213_RELEASE_CHROME_CONTEXT_DEADLINE_EXCEEDED",
    );
    page = await withDeadline(
      () => context!.newPage(),
      deadline,
      now,
      "V213_RELEASE_CHROME_PAGE_DEADLINE_EXCEEDED",
    );
    await withDeadline(
      () =>
        page!.goto(`${origin}/projects/${request.projectId}`, {
          waitUntil: "domcontentloaded",
          timeout: remainingMilliseconds(
            deadline,
            now,
            "V213_RELEASE_CHROME_NAVIGATION_DEADLINE_EXCEEDED",
          ),
        }),
      deadline,
      now,
      "V213_RELEASE_CHROME_NAVIGATION_DEADLINE_EXCEEDED",
    );
    parseTenant(
      await readPageJson(page, "/api/v2/tenant", deadline, now),
      request as unknown as V213V209ChromeRequest,
    );
    parseReleaseProjectDetail(
      await readPageJson(page, `/api/v2/hosted/projects/${request.projectId}`, deadline, now),
      request,
    );
    await withDeadline(
      () =>
        page!.goto(`${origin}/library`, {
          waitUntil: "domcontentloaded",
          timeout: remainingMilliseconds(
            deadline,
            now,
            "V213_RELEASE_CHROME_NAVIGATION_DEADLINE_EXCEEDED",
          ),
        }),
      deadline,
      now,
      "V213_RELEASE_CHROME_NAVIGATION_DEADLINE_EXCEEDED",
    );
    const library = parseLibrary(
      await readPageJson(page, "/api/v2/library", deadline, now),
      {
        finalOutputSha256: request.outputSha256,
      } as V213V209ChromeRequest,
      now().getTime(),
    );
    if (library.project_id !== request.projectId || library.attempt_id !== request.attemptId)
      fail("V213_RELEASE_CHROME_LIBRARY_SCOPE_INVALID");
    const video = await waitForRenderedLocator(
      page,
      "video",
      library.download_url,
      deadline,
      now,
      sleep,
    );
    await provePlayback(video, deadline, now);
    const link = await waitForRenderedLocator(
      page,
      "a[href]",
      library.download_url,
      deadline,
      now,
      sleep,
    );
    await proveDownload(page, link, library, deadline, now);
    const observedAt = now().toISOString();
    if (
      Date.parse(observedAt) < Date.parse(request.smokeTerminalAt) ||
      Date.parse(observedAt) >= deadline
    )
      fail("V213_RELEASE_CHROME_OBSERVED_TIME_INVALID");
    const document: V213ReleaseChromeObservation = Object.freeze({
      schemaVersion: V213_RELEASE_CHROME_OBSERVATION_SCHEMA,
      requestSha256: request.requestSha256,
      fullLiveAuthorityId: request.fullLiveAuthorityId,
      smokeEvidenceSha256: request.smokeEvidenceSha256,
      releaseIdentitySha256: request.releaseIdentitySha256,
      productionUrlSha256: request.productionUrlSha256,
      accountId: request.accountId,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      projectRevisionId: request.projectRevisionId,
      outputSha256: request.outputSha256,
      finalOutputReceiptSha256: request.finalOutputReceiptSha256,
      attemptId: request.attemptId,
      browser: "GOOGLE_CHROME",
      fixtureOrFakeTransportUsed: false,
      playbackPassed: true,
      privateProjectReadbackPassed: true,
      privateRevisionReadbackPassed: true,
      downloadPassed: true,
      downloadedOutputSha256: request.outputSha256,
      observedAt,
    });
    const observationSha256 = canonicalSha256(document);
    const unsignedReceipt = {
      schemaVersion: V213_RELEASE_CHROME_CHILD_RECEIPT_SCHEMA,
      requestSha256: request.requestSha256,
      observationSha256,
      keyId: v213EvidenceKeyId(signingKey),
      document,
    };
    const signatureHex = createHmac("sha256", Buffer.from(signingKey))
      .update(
        [
          "V213_RELEASE_CHROME",
          request.requestSha256,
          observationSha256,
          canonicalSha256(document),
        ].join("\n"),
        "utf8",
      )
      .digest("hex");
    return Object.freeze({ ...unsignedReceipt, signatureHex });
  } catch (error) {
    if (error instanceof V213V209ChromeOperatorError) throw error;
    return fail("V213_RELEASE_CHROME_JOURNEY_FAILED");
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

export function createV213ReleaseChromeJourneySpawner(input: {
  readonly productionOrigin: string;
  readonly authStatePath: string;
  readonly evidenceSigningKey: Uint8Array;
  readonly sourcePins: { readonly moduleSha256: string; readonly entrySha256: string };
  readonly spawn?: typeof spawnProcess;
}): SpawnV213ReleaseChromeJourney {
  return ({ request, childSigningKeyFd, deadlineAt, signal }) => {
    if (childSigningKeyFd !== 3) fail("V213_RELEASE_CHROME_SIGNING_KEY_FD_INVALID");
    if (!verifyV213V209ChromeOperatorSources(input.sourcePins))
      fail("V213_RELEASE_CHROME_SOURCE_DRIFT");
    if (input.evidenceSigningKey.byteLength < 32) fail("V213_RELEASE_CHROME_SIGNING_KEY_INVALID");
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v213-release-chrome-"));
    chmodSync(directory, 0o700);
    const requestPath = join(directory, "request.json");
    writeFileSync(requestPath, canonicalizeJson(request as unknown as JsonValue), {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(requestPath, 0o600);
    const executable = sourcePath(
      V213_V209_CHROME_OPERATOR_ENTRY_URL,
      "src/server/providers/v213-real-chrome-operator-main.ts",
    );
    const safeEnvironment: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "PLAYWRIGHT_BROWSERS_PATH"])
      if (process.env[name] !== undefined) safeEnvironment[name] = process.env[name];
    const child = (input.spawn ?? spawnProcess)(
      process.execPath,
      [
        ...process.execArgv,
        executable,
        "--release-request",
        requestPath,
        "--origin",
        input.productionOrigin,
        "--auth-state",
        input.authStatePath,
      ],
      { env: safeEnvironment, stdio: ["ignore", "pipe", "pipe", "pipe"] },
    );
    const keyPipe = child.stdio[3] as unknown as {
      write(chunk: Uint8Array): boolean;
      end(): void;
    } | null;
    if (!keyPipe) {
      child.kill("SIGKILL");
      rmSync(directory, { recursive: true, force: true });
      fail("V213_RELEASE_CHROME_SIGNING_KEY_PIPE_UNAVAILABLE");
    }
    keyPipe.write(Buffer.from(input.evidenceSigningKey));
    keyPipe.end();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout?.on("data", (chunk: Uint8Array | string) => {
      const bytes = Buffer.from(chunk);
      stdoutBytes += bytes.length;
      if (stdoutBytes <= MAX_REQUEST_BYTES) stdout.push(bytes);
    });
    child.stderr?.on("data", (chunk: Uint8Array | string) => {
      const bytes = Buffer.from(chunk);
      stderrBytes += bytes.length;
      if (stderrBytes <= MAX_CHILD_ERROR_BYTES) stderr.push(bytes);
    });
    const receipt = new Promise<V213ReleaseChromeChildReceipt>((resolvePromise, reject) => {
      let settled = false;
      const finish = (error?: Error, value?: V213ReleaseChromeChildReceipt) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        rmSync(directory, { recursive: true, force: true });
        if (error) reject(error);
        else resolvePromise(value!);
      };
      const abort = () => {
        child.kill("SIGKILL");
        finish(new V213V209ChromeOperatorError("V213_RELEASE_CHROME_CANCELLED"));
      };
      const remaining = Date.parse(deadlineAt) - Date.now();
      const timer = setTimeout(
        () => {
          child.kill("SIGKILL");
          finish(new V213V209ChromeOperatorError("V213_RELEASE_CHROME_DEADLINE_EXCEEDED"));
        },
        Math.max(1, remaining),
      );
      signal.addEventListener("abort", abort, { once: true });
      child.once("error", () =>
        finish(new V213V209ChromeOperatorError("V213_RELEASE_CHROME_JOURNEY_FAILED")),
      );
      child.once("exit", (code) => {
        const childError = protectedChildErrorCode(stderr, stderrBytes);
        const releaseError = Buffer.concat(stderr, Math.min(stderrBytes, MAX_CHILD_ERROR_BYTES))
          .toString("utf8")
          .trim();
        if (childError || RELEASE_CHILD_ERROR_CODE.test(releaseError)) {
          finish(new V213V209ChromeOperatorError(childError ?? releaseError));
          return;
        }
        if (code !== 0 || stdoutBytes === 0 || stdoutBytes > MAX_REQUEST_BYTES) {
          finish(new V213V209ChromeOperatorError("V213_RELEASE_CHROME_JOURNEY_FAILED"));
          return;
        }
        try {
          const value = JSON.parse(Buffer.concat(stdout, stdoutBytes).toString("utf8"));
          finish(undefined, value as V213ReleaseChromeChildReceipt);
        } catch {
          finish(new V213V209ChromeOperatorError("V213_RELEASE_CHROME_CHILD_RECEIPT_INVALID"));
        }
      });
      if (signal.aborted) abort();
    });
    return Object.freeze({
      receipt,
      kill: () => {
        child.kill("SIGKILL");
      },
    });
  };
}

export function readV213V209ChromeRequest(
  requestPath: string,
  now: () => Date = () => new Date(),
): V213V209ChromeRequest {
  return parseRequest(requestPath, now);
}

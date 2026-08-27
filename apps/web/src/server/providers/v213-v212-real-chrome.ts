import { spawn as spawnProcess } from "node:child_process";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";
import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";

import { v213EvidenceKeyId } from "../hosted/v213-live-production-adapters.js";
import {
  parseV213AcceptanceOperatorEvidenceResult,
  V213_ACCEPTANCE_OPERATOR_EVIDENCE_PATH,
  type V213AcceptanceOperatorEvidenceRequest,
  type V213AcceptanceOperatorEvidenceResult,
} from "../runtime/v213-acceptance-operator-evidence.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const SIGNATURE = /^[0-9a-f]{64,512}$/u;
const NONCE = /^[A-Za-z0-9_.:-]{16,190}$/u;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_KEY_BYTES = 256 * 1024;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MIN_DURATION_SECONDS = 29 * 60;
const MAX_DURATION_SECONDS = 31 * 60;
const MAX_TERMINAL_AGE_MS = 24 * 60 * 60 * 1_000;
const POLL_INTERVAL_MS = 500;
const CHILD_ERROR_MAX_BYTES = 4 * 1024;

export const V213_V212_REAL_CHROME_REQUEST_SCHEMA =
  "videoforge.v213-v212-real-chrome-request/v1" as const;
export const V213_V212_REAL_CHROME_OBSERVATION_SCHEMA =
  "videoforge.v213-v212-real-chrome-observation/v1" as const;
export const V213_V212_REAL_CHROME_CHILD_RECEIPT_SCHEMA =
  "videoforge.v213-v212-real-chrome-child-receipt/v1" as const;
export const V213_V212_REAL_CHROME_ERROR_PREFIX = "V213_V212_REAL_CHROME_" as const;
export const V213_V212_REAL_CHROME_CHILD_SIGNING_KEY_FD = 3 as const;

const REQUEST_KEYS = Object.freeze([
  "accountId",
  "attemptId",
  "authoritySha256",
  "checkpoint",
  "deadlineAt",
  "executionId",
  "executionRequestSha256",
  "fullAuthorityExpiresAt",
  "fullLiveAuthorityId",
  "operationId",
  "outerStateSha256",
  "outputBytes",
  "outputReceiptSha256",
  "outputSha256",
  "productionUrlSha256",
  "projectId",
  "projectRevisionId",
  "requestSha256",
  "scopeRequestSha256",
  "schemaVersion",
  "stageAuthorityId",
  "terminalAt",
  "workloadDeadlineAt",
  "workflowId",
  "workspaceId",
]);
const UNSIGNED_REQUEST_KEYS = Object.freeze(REQUEST_KEYS.filter((key) => key !== "requestSha256"));

const OBSERVATION_KEYS = Object.freeze([
  "accountId",
  "attemptId",
  "authenticatedSession",
  "authoritySha256",
  "browser",
  "downloadBytes",
  "downloadSha256",
  "executionId",
  "executionRequestSha256",
  "fixtureOrFakeTransportUsed",
  "fullAuthorityExpiresAt",
  "fullLiveAuthorityId",
  "observedAt",
  "operationId",
  "outerStateSha256",
  "outputReceiptSha256",
  "outputSha256",
  "playbackDurationSeconds",
  "playbackPassed",
  "privateProjectReadbackPassed",
  "privateRevisionReadbackPassed",
  "privateTenantReadbackPassed",
  "productionUrlSha256",
  "projectId",
  "projectRevisionId",
  "requestSha256",
  "scopeRequestSha256",
  "schemaVersion",
  "stageAuthorityId",
  "terminalAt",
  "workloadDeadlineAt",
  "workflowId",
  "workspaceId",
]);

const CHILD_RECEIPT_KEYS = Object.freeze([
  "document",
  "keyId",
  "observationSha256",
  "requestSha256",
  "schemaVersion",
  "signatureHex",
]);

export class V213V212RealChromeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "V213V212RealChromeError";
  }
}

function fail(code: string): never {
  throw new V213V212RealChromeError(`${V213_V212_REAL_CHROME_ERROR_PREFIX}${code}`);
}

function sha256Bytes(value: Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validSha(value: unknown): value is Sha256 {
  return typeof value === "string" && SHA256.test(value);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function exactIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function exactDate(value: unknown): number {
  if (!exactIso(value)) fail("REQUEST_TIME_INVALID");
  return Date.parse(value);
}

function parseObject(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function parseJsonBytes(bytes: Buffer, code: string, maximum: number): Record<string, unknown> {
  if (bytes.length < 1 || bytes.length > maximum) fail(code);
  try {
    return parseObject(JSON.parse(bytes.toString("utf8")), code);
  } catch {
    fail(code);
  }
}

function absolutePath(value: string, code: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) fail(code);
  const resolved = resolve(value);
  if (resolved !== value) fail(code);
  return resolved;
}

function mode(path: string, expected: number, code: string): void {
  try {
    if ((lstatSync(path).mode & 0o7777) !== expected) fail(code);
  } catch {
    fail(code);
  }
}

function privateFile(path: string, code: string): string {
  const resolved = absolutePath(path, code);
  try {
    if (!lstatSync(resolved).isFile()) fail(code);
  } catch {
    fail(code);
  }
  mode(resolved, 0o600, code);
  return resolved;
}

function readSigningKey(input: {
  readonly evidenceSigningKey?: Uint8Array;
  readonly evidenceSigningKeyFd?: number;
}): Uint8Array {
  if (input.evidenceSigningKey !== undefined) {
    if (input.evidenceSigningKey.byteLength < 32) fail("SIGNING_KEY_INVALID");
    return Uint8Array.from(input.evidenceSigningKey);
  }
  const fd = input.evidenceSigningKeyFd;
  if (!Number.isSafeInteger(fd) || (fd as number) < 3) fail("SIGNING_KEY_FD_INVALID");
  let bytes: Buffer;
  try {
    bytes = readFileSync(fd as number);
  } catch {
    fail("SIGNING_KEY_READ_FAILED");
  }
  if (bytes.length < 32 || bytes.length > MAX_KEY_BYTES) fail("SIGNING_KEY_INVALID");
  return Uint8Array.from(bytes);
}

function productionOrigin(value: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.includes("\0"))
    fail("ORIGIN_INVALID");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail("ORIGIN_INVALID");
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
    fail("ORIGIN_INVALID");
  return parsed.origin;
}

function originSha256(origin: string): Sha256 {
  return sha256Bytes(Buffer.from(origin, "utf8"));
}

function remainingMilliseconds(deadlineAt: number, now: () => Date, code: string): number {
  const remaining = deadlineAt - now().getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) fail(code);
  return Math.floor(remaining);
}

async function withDeadline<T>(
  operation: () => Promise<T>,
  deadlineAt: number,
  now: () => Date,
  code: string,
): Promise<T> {
  const remaining = remainingMilliseconds(deadlineAt, now, code);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operationPromise = Promise.resolve().then(operation);
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new V213V212RealChromeError(`${V213_V212_REAL_CHROME_ERROR_PREFIX}${code}`)),
      remaining,
    );
  });
  try {
    const result = await Promise.race([operationPromise, timeoutPromise]);
    if (now().getTime() >= deadlineAt) fail(code);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface V213V212RealChromeRequest {
  readonly schemaVersion: typeof V213_V212_REAL_CHROME_REQUEST_SCHEMA;
  readonly fullLiveAuthorityId: string;
  readonly stageAuthorityId: string;
  readonly outerStateSha256: Sha256;
  readonly operationId: "v2-12-long-output";
  readonly checkpoint: "V2-12";
  readonly workflowId: string;
  readonly executionId: string;
  readonly executionRequestSha256: Sha256;
  readonly authoritySha256: Sha256;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly attemptId: string;
  readonly scopeRequestSha256: Sha256;
  readonly outputSha256: Sha256;
  readonly outputReceiptSha256: Sha256;
  readonly outputBytes: number;
  readonly productionUrlSha256: Sha256;
  readonly terminalAt: string;
  readonly workloadDeadlineAt: string;
  readonly fullAuthorityExpiresAt: string;
  readonly deadlineAt: string;
  readonly requestSha256: Sha256;
}

export type V213V212RealChromeRequestInput = Omit<
  V213V212RealChromeRequest,
  "schemaVersion" | "requestSha256"
>;

function unsignedRequest(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(UNSIGNED_REQUEST_KEYS.map((key) => [key, value[key]]));
}

function validateRequestFields(
  value: Readonly<Record<string, unknown>>,
  now: Date,
  verifyHash: boolean,
): void {
  if (!exactKeys(value, REQUEST_KEYS)) fail("REQUEST_FIELDS_INVALID");
  if (value.schemaVersion !== V213_V212_REAL_CHROME_REQUEST_SCHEMA) fail("REQUEST_SCHEMA_INVALID");
  if (value.operationId !== "v2-12-long-output" || value.checkpoint !== "V2-12")
    fail("REQUEST_OPERATION_INVALID");
  if (
    typeof value.fullLiveAuthorityId !== "string" ||
    !UUID.test(value.fullLiveAuthorityId) ||
    typeof value.stageAuthorityId !== "string" ||
    !UUID.test(value.stageAuthorityId) ||
    !validIdentifier(value.workflowId) ||
    !validIdentifier(value.executionId) ||
    value.workflowId !== `v213-v2-12-${value.executionId}`
  )
    fail("REQUEST_IDENTITY_INVALID");
  if (
    ![
      value.outerStateSha256,
      value.executionRequestSha256,
      value.authoritySha256,
      value.scopeRequestSha256,
      value.outputSha256,
      value.outputReceiptSha256,
      value.productionUrlSha256,
      value.requestSha256,
    ].every(validSha)
  )
    fail("REQUEST_HASH_INVALID");
  if (
    ![value.accountId, value.workspaceId, value.projectId, value.projectRevisionId].every(
      (item) => typeof item === "string" && UUID.test(item),
    ) ||
    !validIdentifier(value.attemptId)
  )
    fail("REQUEST_SCOPE_INVALID");
  if (!Number.isSafeInteger(value.outputBytes) || Number(value.outputBytes) < 1)
    fail("REQUEST_OUTPUT_LENGTH_INVALID");
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) fail("NOW_INVALID");
  const terminalAt = exactDate(value.terminalAt);
  const workloadDeadlineAt = exactDate(value.workloadDeadlineAt);
  const fullAuthorityExpiresAt = exactDate(value.fullAuthorityExpiresAt);
  const deadlineAt = exactDate(value.deadlineAt);
  if (
    terminalAt > nowMs ||
    nowMs - terminalAt > MAX_TERMINAL_AGE_MS ||
    deadlineAt <= nowMs ||
    workloadDeadlineAt <= nowMs ||
    fullAuthorityExpiresAt <= nowMs ||
    deadlineAt !== Math.min(workloadDeadlineAt, fullAuthorityExpiresAt) ||
    terminalAt >= deadlineAt
  )
    fail("REQUEST_DEADLINE_INVALID");
  if (
    verifyHash &&
    (!validSha(value.requestSha256) ||
      canonicalSha256(unsignedRequest(value)) !== value.requestSha256)
  )
    fail("REQUEST_HASH_INVALID");
}

export function buildV213V212RealChromeRequest(
  input: V213V212RealChromeRequestInput,
  now: Date = new Date(),
): V213V212RealChromeRequest {
  const unsigned = {
    schemaVersion: V213_V212_REAL_CHROME_REQUEST_SCHEMA,
    ...structuredClone(input),
  } as Readonly<Record<string, unknown>>;
  const request = { ...unsigned, requestSha256: canonicalSha256(unsigned) };
  validateRequestFields(request, now, true);
  return Object.freeze(request as V213V212RealChromeRequest);
}

export function validateV213V212RealChromeRequest(
  value: Readonly<object>,
  now: Date = new Date(),
): V213V212RealChromeRequest {
  const request = value as Readonly<Record<string, unknown>>;
  validateRequestFields(request, now, true);
  return Object.freeze(structuredClone(value) as V213V212RealChromeRequest);
}

export interface V213V212RealChromeObservation {
  readonly schemaVersion: typeof V213_V212_REAL_CHROME_OBSERVATION_SCHEMA;
  readonly requestSha256: Sha256;
  readonly fullLiveAuthorityId: string;
  readonly stageAuthorityId: string;
  readonly outerStateSha256: Sha256;
  readonly operationId: "v2-12-long-output";
  readonly workflowId: string;
  readonly executionId: string;
  readonly executionRequestSha256: Sha256;
  readonly authoritySha256: Sha256;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly attemptId: string;
  readonly scopeRequestSha256: Sha256;
  readonly outputSha256: Sha256;
  readonly outputReceiptSha256: Sha256;
  readonly productionUrlSha256: Sha256;
  readonly terminalAt: string;
  readonly workloadDeadlineAt: string;
  readonly fullAuthorityExpiresAt: string;
  readonly browser: "GOOGLE_CHROME";
  readonly authenticatedSession: true;
  readonly fixtureOrFakeTransportUsed: false;
  readonly privateTenantReadbackPassed: true;
  readonly privateProjectReadbackPassed: true;
  readonly privateRevisionReadbackPassed: true;
  readonly playbackPassed: true;
  readonly playbackDurationSeconds: number;
  readonly downloadSha256: Sha256;
  readonly downloadBytes: number;
  readonly observedAt: string;
}

export interface V213V212RealChromeChildReceipt {
  readonly schemaVersion: typeof V213_V212_REAL_CHROME_CHILD_RECEIPT_SCHEMA;
  readonly requestSha256: Sha256;
  readonly observationSha256: Sha256;
  readonly keyId: string;
  readonly signatureHex: string;
  readonly document: V213V212RealChromeObservation;
}

export interface V213V212RealChromeVerifiedChildReceipt {
  readonly verifierId: "videoforge-v213-v212-real-chrome-child-receipt-verifier-v1";
  readonly accepted: true;
  readonly canonicalReceiptSha256: Sha256;
  readonly signatureSha256: Sha256;
  readonly signatureVerified: true;
}

export interface V213V212RealChromeJourneyProcess {
  readonly receipt: Promise<V213V212RealChromeChildReceipt>;
  kill(signal: "SIGKILL"): void;
}

export type SpawnV213V212RealChromeJourney = (input: {
  readonly request: V213V212RealChromeRequest;
  readonly childSigningKeyFd: number;
  readonly deadlineAt: string;
  readonly signal: AbortSignal;
}) => V213V212RealChromeJourneyProcess;

export interface V213V212RealChromeLocator {
  count(): Promise<number>;
  nth(index: number): V213V212RealChromeLocator;
  getAttribute(name: string): Promise<string | null>;
  evaluate<T>(
    callback: (element: unknown, argument?: unknown) => T | Promise<T>,
    argument?: unknown,
  ): Promise<T>;
  click(options?: Readonly<Record<string, unknown>>): Promise<void>;
}

export interface V213V212RealChromeDownload {
  path(): Promise<string | null>;
  failure(): Promise<string | null>;
  delete(): Promise<void>;
}

export interface V213V212RealChromePage {
  goto(url: string, options?: Readonly<Record<string, unknown>>): Promise<unknown>;
  evaluate<T>(callback: (argument?: unknown) => T | Promise<T>, argument?: unknown): Promise<T>;
  locator(selector: string): V213V212RealChromeLocator;
  waitForEvent(
    name: "download",
    options?: Readonly<Record<string, unknown>>,
  ): Promise<V213V212RealChromeDownload>;
  close(): Promise<void>;
}

export interface V213V212RealChromeContext {
  route(
    url: string,
    handler: (route: {
      request(): { method(): string };
      continue(): Promise<void>;
      abort(errorCode?: string): Promise<void>;
    }) => Promise<void>,
  ): Promise<void>;
  newPage(): Promise<V213V212RealChromePage>;
  close(): Promise<void>;
}

export interface V213V212RealChromeBrowser {
  newContext(options: {
    readonly storageState: string;
    readonly acceptDownloads: true;
    readonly baseURL: string;
  }): Promise<V213V212RealChromeContext>;
  close(): Promise<void>;
}

export type LaunchV213V212InstalledChrome = (options: {
  readonly channel: "chrome";
  readonly headless: false;
}) => Promise<V213V212RealChromeBrowser>;

const launchInstalledChrome: LaunchV213V212InstalledChrome = async (options) =>
  (await chromium.launch(options)) as unknown as V213V212RealChromeBrowser;

const V213_V212_REAL_CHROME_MODULE_URL = new URL("./v213-v212-real-chrome.ts", import.meta.url);
const V213_V212_REAL_CHROME_ENTRY_URL = new URL("./v213-v212-real-chrome-main.ts", import.meta.url);

function sourcePath(url: URL, fallbackRelativePath: string): string {
  try {
    if (url.protocol === "file:") return fileURLToPath(url);
    const candidates = [
      resolve(process.cwd(), fallbackRelativePath),
      resolve(process.cwd(), "apps/web", fallbackRelativePath),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) fail("SOURCE_UNAVAILABLE");
    return path;
  } catch {
    fail("SOURCE_UNAVAILABLE");
  }
}

export function verifyV213V212RealChromeSources(expected: {
  readonly moduleSha256: Sha256;
  readonly entrySha256: Sha256;
}): boolean {
  try {
    return (
      sha256Bytes(
        readFileSync(
          sourcePath(
            V213_V212_REAL_CHROME_MODULE_URL,
            "src/server/providers/v213-v212-real-chrome.ts",
          ),
        ),
      ) === expected.moduleSha256 &&
      sha256Bytes(
        readFileSync(
          sourcePath(
            V213_V212_REAL_CHROME_ENTRY_URL,
            "src/server/providers/v213-v212-real-chrome-main.ts",
          ),
        ),
      ) === expected.entrySha256
    );
  } catch {
    return false;
  }
}

function parseRequestFile(path: string, now: () => Date): V213V212RealChromeRequest {
  const requestPath = privateFile(path, "REQUEST_MODE_INVALID");
  const bytes = readFileSync(requestPath);
  const value = parseJsonBytes(bytes, "REQUEST_JSON_INVALID", MAX_REQUEST_BYTES);
  if (canonicalizeJson(value as JsonValue) !== bytes.toString("utf8"))
    fail("REQUEST_NOT_CANONICAL");
  return validateV213V212RealChromeRequest(value, now());
}

function validateAuthState(path: string): string {
  const authState = privateFile(path, "AUTH_STATE_MODE_INVALID");
  mode(dirname(authState), 0o700, "AUTH_STATE_DIRECTORY_MODE_INVALID");
  const value = parseJsonBytes(readFileSync(authState), "AUTH_STATE_INVALID", MAX_KEY_BYTES);
  if (
    !exactKeys(value, ["cookies", "origins"]) ||
    !Array.isArray(value.cookies) ||
    !Array.isArray(value.origins)
  )
    fail("AUTH_STATE_INVALID");
  return authState;
}

async function readPageJson(
  page: V213V212RealChromePage,
  path: string,
  deadlineAt: number,
  now: () => Date,
): Promise<Record<string, unknown>> {
  const result = await withDeadline(
    () =>
      page.evaluate(
        async (argument) => {
          const request = argument as { readonly path?: unknown; readonly deadlineAt?: unknown };
          if (typeof request?.path !== "string" || typeof request.deadlineAt !== "number")
            throw new Error("request binding missing");
          const remaining = request.deadlineAt - Date.now();
          if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("deadline expired");
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), Math.floor(remaining));
          try {
            const response = await fetch(request.path, {
              method: "GET",
              headers: { accept: "application/json" },
              redirect: "error",
              signal: controller.signal,
            });
            return { status: response.status, body: await response.text() };
          } finally {
            clearTimeout(timer);
          }
        },
        { path, deadlineAt },
      ),
    deadlineAt,
    now,
    "API_DEADLINE_EXCEEDED",
  );
  if (result.status !== 200 || typeof result.body !== "string") fail("API_UNAVAILABLE");
  return parseJsonBytes(Buffer.from(result.body, "utf8"), "API_JSON_INVALID", MAX_JSON_BYTES);
}

function parseTenant(value: Record<string, unknown>, request: V213V212RealChromeRequest): void {
  if (
    value.schema_version !== "videoforge-hosted-tenant/v1" ||
    value.account_id !== request.accountId ||
    value.workspace_id !== request.workspaceId
  )
    fail("TENANT_SCOPE_INVALID");
}

function parseProjectDetail(
  value: Record<string, unknown>,
  request: V213V212RealChromeRequest,
): void {
  const project = parseObject(value.project, "PROJECT_READBACK_INVALID");
  if (!Array.isArray(value.attempts)) fail("PROJECT_READBACK_INVALID");
  if (project.id !== request.projectId || project.revision_id !== request.projectRevisionId)
    fail("PROJECT_SCOPE_INVALID");
  const attempts = value.attempts.filter(
    (candidate): candidate is Record<string, unknown> =>
      candidate !== null && typeof candidate === "object" && !Array.isArray(candidate),
  );
  const matches = attempts.filter(
    (attempt) =>
      attempt.id === request.attemptId &&
      attempt.kind === "RENDER" &&
      attempt.state === "SUCCEEDED" &&
      attempt.output_checksum_sha256 === request.outputSha256,
  );
  if (matches.length !== 1) fail("PROJECT_ATTEMPT_READBACK_INVALID");
}

interface LibraryOutput {
  readonly attemptId: string;
  readonly projectId: string;
  readonly contentLength: number;
  readonly checksumSha256: Sha256;
  readonly downloadUrl: string;
  readonly downloadExpiresAt: number;
}

function parseLibrary(
  value: Record<string, unknown>,
  request: V213V212RealChromeRequest,
  nowMs: number,
): LibraryOutput {
  if (value.schema_version !== "videoforge-hosted-library/v1" || !Array.isArray(value.outputs))
    fail("LIBRARY_INVALID");
  const matches = value.outputs.filter(
    (candidate): candidate is Record<string, unknown> =>
      candidate !== null &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      candidate.checksum_sha256 === request.outputSha256,
  );
  if (matches.length !== 1)
    fail(matches.length === 0 ? "LIBRARY_OUTPUT_NOT_FOUND" : "LIBRARY_OUTPUT_AMBIGUOUS");
  const output = matches[0]!;
  if (
    !exactKeys(output, [
      "attempt_id",
      "checksum_sha256",
      "content_length",
      "created_at",
      "download_expires_at",
      "download_url",
      "project_id",
      "title",
    ]) ||
    !validIdentifier(output.attempt_id) ||
    output.attempt_id !== request.attemptId ||
    !validIdentifier(output.project_id) ||
    output.project_id !== request.projectId ||
    !validSha(output.checksum_sha256) ||
    output.checksum_sha256 !== request.outputSha256 ||
    !Number.isSafeInteger(output.content_length) ||
    Number(output.content_length) !== request.outputBytes ||
    Number(output.content_length) < 1 ||
    Number(output.content_length) > MAX_DOWNLOAD_BYTES ||
    typeof output.title !== "string" ||
    !exactIso(output.created_at)
  )
    fail("LIBRARY_OUTPUT_INVALID");
  let downloadUrl: URL;
  const downloadExpiresAt = Date.parse(String(output.download_expires_at));
  try {
    downloadUrl = new URL(String(output.download_url));
  } catch {
    fail("LIBRARY_OUTPUT_INVALID");
  }
  if (
    downloadUrl.protocol !== "https:" ||
    downloadUrl.username !== "" ||
    downloadUrl.password !== "" ||
    !exactIso(output.download_expires_at) ||
    downloadExpiresAt <= nowMs
  )
    fail("LIBRARY_OUTPUT_INVALID");
  return Object.freeze({
    attemptId: output.attempt_id,
    projectId: output.project_id,
    contentLength: Number(output.content_length),
    checksumSha256: output.checksum_sha256,
    downloadUrl: downloadUrl.toString(),
    downloadExpiresAt,
  });
}

async function installReadOnlyRouteGuard(context: V213V212RealChromeContext): Promise<void> {
  await context.route("**/*", async (route) => {
    const method = route.request().method().toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
    fail("MUTATION_ROUTE_BLOCKED");
  });
}

async function waitForRenderedLocator(
  page: V213V212RealChromePage,
  selector: string,
  expectedUrl: string,
  deadlineAt: number,
  now: () => Date,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<V213V212RealChromeLocator> {
  const locator = page.locator(selector);
  while (now().getTime() < deadlineAt) {
    const count = await withDeadline(
      () => locator.count(),
      deadlineAt,
      now,
      "UI_OUTPUT_DEADLINE_EXCEEDED",
    );
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      const source =
        (await withDeadline(
          () => candidate.getAttribute("src"),
          deadlineAt,
          now,
          "UI_OUTPUT_DEADLINE_EXCEEDED",
        )) ??
        (await withDeadline(
          () => candidate.getAttribute("href"),
          deadlineAt,
          now,
          "UI_OUTPUT_DEADLINE_EXCEEDED",
        ));
      if (source === expectedUrl) return candidate;
    }
    const remaining = remainingMilliseconds(deadlineAt, now, "UI_OUTPUT_NOT_RENDERED");
    await withDeadline(
      () => sleep(Math.min(POLL_INTERVAL_MS, remaining)),
      deadlineAt,
      now,
      "UI_OUTPUT_NOT_RENDERED",
    );
  }
  fail("UI_OUTPUT_NOT_RENDERED");
}

async function provePlayback(
  video: V213V212RealChromeLocator,
  deadlineAt: number,
  now: () => Date,
): Promise<number> {
  const facts = await withDeadline(
    () =>
      video.evaluate(
        async (element, argument) => {
          const deadline =
            argument &&
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
          const waitUntilReady = async (): Promise<void> => {
            while (media.readyState < 1) {
              const remaining = deadline - Date.now();
              if (!Number.isFinite(remaining) || remaining <= 0)
                throw new Error("deadline expired");
              await new Promise<void>((resolvePromise) =>
                setTimeout(resolvePromise, Math.min(100, Math.floor(remaining))),
              );
            }
          };
          const waitForProgress = async (): Promise<void> => {
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
          await waitUntilReady();
          await media.play();
          await waitForProgress();
          return { durationSeconds: media.duration, currentTime: media.currentTime };
        },
        { deadlineAt },
      ),
    deadlineAt,
    now,
    "PLAYBACK_DEADLINE_EXCEEDED",
  );
  if (
    !Number.isFinite(facts.durationSeconds) ||
    facts.durationSeconds < MIN_DURATION_SECONDS ||
    facts.durationSeconds > MAX_DURATION_SECONDS ||
    !Number.isFinite(facts.currentTime) ||
    facts.currentTime <= 0
  )
    fail("PLAYBACK_INVALID");
  return facts.durationSeconds;
}

async function hashFile(
  path: string,
  expectedBytes: number,
  deadlineAt: number,
  now: () => Date,
): Promise<Sha256> {
  const resolved = absolutePath(path, "DOWNLOAD_PATH_INVALID");
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(resolved);
  } catch {
    fail("DOWNLOAD_PATH_INVALID");
  }
  if (
    !stat.isFile() ||
    stat.size !== expectedBytes ||
    stat.size < 1 ||
    stat.size > MAX_DOWNLOAD_BYTES
  )
    fail("DOWNLOAD_LENGTH_INVALID");
  const controller = new AbortController();
  const stream = createReadStream(resolved, { signal: controller.signal });
  const digest = createHash("sha256");
  let bytes = 0;
  const result = new Promise<Sha256>((resolvePromise, reject) => {
    stream.on("data", (chunk: Buffer | string) => {
      const part = Buffer.from(chunk);
      bytes += part.length;
      digest.update(part);
    });
    stream.once("error", reject);
    stream.once("end", () => {
      if (bytes !== expectedBytes) {
        reject(
          new V213V212RealChromeError(
            `${V213_V212_REAL_CHROME_ERROR_PREFIX}DOWNLOAD_LENGTH_INVALID`,
          ),
        );
        return;
      }
      resolvePromise(`sha256:${digest.digest("hex")}`);
    });
  });
  try {
    return await withDeadline(() => result, deadlineAt, now, "DOWNLOAD_DEADLINE_EXCEEDED");
  } finally {
    controller.abort();
  }
}

async function proveDownload(
  page: V213V212RealChromePage,
  link: V213V212RealChromeLocator,
  expected: LibraryOutput,
  deadlineAt: number,
  now: () => Date,
): Promise<{ readonly sha256: Sha256; readonly bytes: number }> {
  let download: V213V212RealChromeDownload | undefined;
  try {
    const downloadPromise = page.waitForEvent("download", {
      timeout: remainingMilliseconds(deadlineAt, now, "DOWNLOAD_DEADLINE_EXCEEDED"),
    });
    await withDeadline(
      () =>
        link.click({
          timeout: remainingMilliseconds(deadlineAt, now, "DOWNLOAD_DEADLINE_EXCEEDED"),
        }),
      deadlineAt,
      now,
      "DOWNLOAD_DEADLINE_EXCEEDED",
    );
    download = await withDeadline(
      () => downloadPromise,
      deadlineAt,
      now,
      "DOWNLOAD_DEADLINE_EXCEEDED",
    );
    if (
      (await withDeadline(
        () => download!.failure(),
        deadlineAt,
        now,
        "DOWNLOAD_DEADLINE_EXCEEDED",
      )) !== null
    )
      fail("DOWNLOAD_FAILED");
    const path = await withDeadline(
      () => download!.path(),
      deadlineAt,
      now,
      "DOWNLOAD_PATH_UNAVAILABLE",
    );
    if (!path) fail("DOWNLOAD_PATH_UNAVAILABLE");
    const sha256 = await hashFile(path, expected.contentLength, deadlineAt, now);
    if (sha256 !== expected.checksumSha256) fail("DOWNLOAD_HASH_INVALID");
    return Object.freeze({ sha256, bytes: expected.contentLength });
  } catch (error) {
    if (error instanceof V213V212RealChromeError) throw error;
    return fail("DOWNLOAD_FAILED");
  } finally {
    if (download) await download.delete().catch(() => undefined);
  }
}

function signChildReceipt(
  request: V213V212RealChromeRequest,
  document: V213V212RealChromeObservation,
  signingKey: Uint8Array,
): V213V212RealChromeChildReceipt {
  const observationSha256 = canonicalSha256(document as unknown as Record<string, unknown>);
  const signatureHex = createHmac("sha256", Buffer.from(signingKey))
    .update(`V212_REAL_CHROME\n${request.requestSha256}\n${observationSha256}`, "utf8")
    .digest("hex");
  return Object.freeze({
    schemaVersion: V213_V212_REAL_CHROME_CHILD_RECEIPT_SCHEMA,
    requestSha256: request.requestSha256,
    observationSha256,
    keyId: v213EvidenceKeyId(signingKey),
    signatureHex,
    document,
  });
}

export async function runV213V212RealChromeJourney(input: {
  readonly requestPath: string;
  readonly productionOrigin: string;
  readonly authStatePath: string;
  readonly evidenceSigningKey?: Uint8Array;
  readonly evidenceSigningKeyFd?: number;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly launch?: LaunchV213V212InstalledChrome;
}): Promise<V213V212RealChromeChildReceipt> {
  const now = input.now ?? (() => new Date());
  const sleep =
    input.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds)));
  const request = parseRequestFile(input.requestPath, now);
  const origin = productionOrigin(input.productionOrigin);
  if (originSha256(origin) !== request.productionUrlSha256) fail("ORIGIN_HASH_INVALID");
  const authStatePath = validateAuthState(input.authStatePath);
  const signingKey = readSigningKey(input);
  const deadlineAt = Date.parse(request.deadlineAt);
  let browser: V213V212RealChromeBrowser | undefined;
  let context: V213V212RealChromeContext | undefined;
  let page: V213V212RealChromePage | undefined;
  try {
    const launch = input.launch ?? launchInstalledChrome;
    browser = await withDeadline(
      () => launch({ channel: "chrome", headless: false }),
      deadlineAt,
      now,
      "LAUNCH_DEADLINE_EXCEEDED",
    );
    context = await withDeadline(
      () =>
        browser!.newContext({
          storageState: authStatePath,
          acceptDownloads: true,
          baseURL: origin,
        }),
      deadlineAt,
      now,
      "CONTEXT_DEADLINE_EXCEEDED",
    );
    await withDeadline(
      () => installReadOnlyRouteGuard(context!),
      deadlineAt,
      now,
      "CONTEXT_DEADLINE_EXCEEDED",
    );
    page = await withDeadline(() => context!.newPage(), deadlineAt, now, "PAGE_DEADLINE_EXCEEDED");
    await withDeadline(
      () =>
        page!.goto(`${origin}/projects/${request.projectId}`, {
          waitUntil: "domcontentloaded",
          timeout: remainingMilliseconds(deadlineAt, now, "NAVIGATION_DEADLINE_EXCEEDED"),
        }),
      deadlineAt,
      now,
      "NAVIGATION_DEADLINE_EXCEEDED",
    );
    parseTenant(await readPageJson(page, "/api/v2/tenant", deadlineAt, now), request);
    parseProjectDetail(
      await readPageJson(page, `/api/v2/hosted/projects/${request.projectId}`, deadlineAt, now),
      request,
    );
    await withDeadline(
      () =>
        page!.goto(`${origin}/library`, {
          waitUntil: "domcontentloaded",
          timeout: remainingMilliseconds(deadlineAt, now, "NAVIGATION_DEADLINE_EXCEEDED"),
        }),
      deadlineAt,
      now,
      "NAVIGATION_DEADLINE_EXCEEDED",
    );
    const library = parseLibrary(
      await readPageJson(page, "/api/v2/library", deadlineAt, now),
      request,
      now().getTime(),
    );
    const video = await waitForRenderedLocator(
      page,
      "video",
      library.downloadUrl,
      deadlineAt,
      now,
      sleep,
    );
    const playbackDurationSeconds = await provePlayback(video, deadlineAt, now);
    const link = await waitForRenderedLocator(
      page,
      "a[href]",
      library.downloadUrl,
      deadlineAt,
      now,
      sleep,
    );
    const downloaded = await proveDownload(page, link, library, deadlineAt, now);
    const observedAt = now().toISOString();
    if (
      !exactIso(observedAt) ||
      Date.parse(observedAt) < Date.parse(request.terminalAt) ||
      Date.parse(observedAt) >= deadlineAt
    )
      fail("OBSERVED_TIME_INVALID");
    const document: V213V212RealChromeObservation = Object.freeze({
      schemaVersion: V213_V212_REAL_CHROME_OBSERVATION_SCHEMA,
      requestSha256: request.requestSha256,
      fullLiveAuthorityId: request.fullLiveAuthorityId,
      stageAuthorityId: request.stageAuthorityId,
      outerStateSha256: request.outerStateSha256,
      operationId: request.operationId,
      workflowId: request.workflowId,
      executionId: request.executionId,
      executionRequestSha256: request.executionRequestSha256,
      authoritySha256: request.authoritySha256,
      accountId: request.accountId,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      projectRevisionId: request.projectRevisionId,
      attemptId: request.attemptId,
      scopeRequestSha256: request.scopeRequestSha256,
      outputSha256: request.outputSha256,
      outputReceiptSha256: request.outputReceiptSha256,
      productionUrlSha256: request.productionUrlSha256,
      terminalAt: request.terminalAt,
      workloadDeadlineAt: request.workloadDeadlineAt,
      fullAuthorityExpiresAt: request.fullAuthorityExpiresAt,
      browser: "GOOGLE_CHROME",
      authenticatedSession: true,
      fixtureOrFakeTransportUsed: false,
      privateTenantReadbackPassed: true,
      privateProjectReadbackPassed: true,
      privateRevisionReadbackPassed: true,
      playbackPassed: true,
      playbackDurationSeconds,
      downloadSha256: downloaded.sha256,
      downloadBytes: downloaded.bytes,
      observedAt,
    });
    if (!exactKeys(document as unknown as Record<string, unknown>, OBSERVATION_KEYS))
      fail("OBSERVATION_FIELDS_INVALID");
    return signChildReceipt(request, document, signingKey);
  } catch (error) {
    if (error instanceof V213V212RealChromeError) throw error;
    return fail("JOURNEY_FAILED");
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

function validateChildObservation(
  document: Readonly<Record<string, unknown>>,
  request: V213V212RealChromeRequest,
  now: Date,
): void {
  if (!exactKeys(document as unknown as Record<string, unknown>, OBSERVATION_KEYS))
    fail("OBSERVATION_FIELDS_INVALID");
  if (document.schemaVersion !== V213_V212_REAL_CHROME_OBSERVATION_SCHEMA)
    fail("OBSERVATION_SCHEMA_INVALID");
  for (const key of [
    "requestSha256",
    "fullLiveAuthorityId",
    "stageAuthorityId",
    "outerStateSha256",
    "operationId",
    "workflowId",
    "executionId",
    "executionRequestSha256",
    "authoritySha256",
    "accountId",
    "workspaceId",
    "projectId",
    "projectRevisionId",
    "attemptId",
    "scopeRequestSha256",
    "outputSha256",
    "outputReceiptSha256",
    "productionUrlSha256",
    "terminalAt",
    "workloadDeadlineAt",
    "fullAuthorityExpiresAt",
  ] as const) {
    if (document[key] !== request[key]) fail("OBSERVATION_IDENTITY_DRIFT");
  }
  if (
    document.browser !== "GOOGLE_CHROME" ||
    document.authenticatedSession !== true ||
    document.fixtureOrFakeTransportUsed !== false ||
    document.privateTenantReadbackPassed !== true ||
    document.privateProjectReadbackPassed !== true ||
    document.privateRevisionReadbackPassed !== true ||
    document.playbackPassed !== true ||
    !validSha(document.downloadSha256) ||
    document.downloadSha256 !== request.outputSha256 ||
    !Number.isSafeInteger(document.downloadBytes) ||
    document.downloadBytes !== request.outputBytes ||
    !Number.isFinite(document.playbackDurationSeconds) ||
    Number(document.playbackDurationSeconds) < MIN_DURATION_SECONDS ||
    Number(document.playbackDurationSeconds) > MAX_DURATION_SECONDS ||
    !exactIso(document.observedAt) ||
    Date.parse(document.observedAt) < Date.parse(request.terminalAt) ||
    Date.parse(document.observedAt) > now.getTime() ||
    Date.parse(document.observedAt) >= Date.parse(request.deadlineAt)
  )
    fail("OBSERVATION_PROOF_INVALID");
}

export function verifyV213V212RealChromeChildReceipt(
  value: unknown,
  request: V213V212RealChromeRequest,
  signingKey: Uint8Array,
  now: Date = new Date(),
): V213V212RealChromeVerifiedChildReceipt {
  if (signingKey.byteLength < 32) fail("SIGNING_KEY_INVALID");
  const receipt = parseObject(value, "CHILD_RECEIPT_INVALID");
  if (!exactKeys(receipt, CHILD_RECEIPT_KEYS)) fail("CHILD_RECEIPT_FIELDS_INVALID");
  if (
    receipt.schemaVersion !== V213_V212_REAL_CHROME_CHILD_RECEIPT_SCHEMA ||
    receipt.requestSha256 !== request.requestSha256 ||
    typeof receipt.keyId !== "string" ||
    !validIdentifier(receipt.keyId) ||
    receipt.keyId !== v213EvidenceKeyId(signingKey) ||
    typeof receipt.signatureHex !== "string" ||
    !SIGNATURE.test(receipt.signatureHex)
  )
    fail("CHILD_RECEIPT_INVALID");
  const document = parseObject(receipt.document, "OBSERVATION_INVALID");
  validateChildObservation(document, request, now);
  const observationSha256 = canonicalSha256(document);
  if (receipt.observationSha256 !== observationSha256) fail("CHILD_RECEIPT_HASH_INVALID");
  const expected = createHmac("sha256", Buffer.from(signingKey))
    .update(`V212_REAL_CHROME\n${request.requestSha256}\n${observationSha256}`, "utf8")
    .digest("hex");
  const actualBytes = Buffer.from(String(receipt.signatureHex), "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes))
    fail("CHILD_SIGNATURE_INVALID");
  return Object.freeze({
    verifierId: "videoforge-v213-v212-real-chrome-child-receipt-verifier-v1",
    accepted: true,
    canonicalReceiptSha256: canonicalSha256(receipt),
    signatureSha256: canonicalSha256({ keyId: receipt.keyId, signatureHex: receipt.signatureHex }),
    signatureVerified: true,
  });
}

function evidenceRequest(
  request: V213V212RealChromeRequest,
  receipt: V213V212RealChromeChildReceipt,
  now: Date,
  nonce: string,
): V213AcceptanceOperatorEvidenceRequest {
  const observedAt = receipt.document.observedAt;
  const issuedAt = now.toISOString();
  if (
    !exactIso(issuedAt) ||
    Date.parse(issuedAt) < Date.parse(observedAt) ||
    Date.parse(issuedAt) >= Date.parse(request.deadlineAt) ||
    !NONCE.test(nonce)
  )
    fail("EVIDENCE_TIME_INVALID");
  const binding = Object.freeze({
    fullLiveAuthorityId: request.fullLiveAuthorityId,
    operationId: request.operationId,
    checkpoint: request.checkpoint,
    stageAuthorityId: request.stageAuthorityId,
    outerStateSha256: request.outerStateSha256,
    workflowId: request.workflowId,
    executionId: request.executionId,
    executionRequestSha256: request.executionRequestSha256,
    authoritySha256: request.authoritySha256,
  });
  const evidence = Object.freeze({
    schemaVersion: "videoforge.v213-v212-real-chrome-evidence/v1" as const,
    kind: "V212_REAL_CHROME" as const,
    scope: Object.freeze({
      accountId: request.accountId,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      projectRevisionId: request.projectRevisionId,
      requestSha256: request.scopeRequestSha256,
      attemptId: request.attemptId,
    }),
    outputSha256: request.outputSha256,
    outputReceiptSha256: request.outputReceiptSha256,
    productionUrlSha256: request.productionUrlSha256,
    chromeReceiptSha256: canonicalSha256(receipt),
    authenticatedSession: true as const,
    privateReadbackPassed: true as const,
    playbackPassed: true as const,
    downloadSha256: receipt.document.downloadSha256,
    downloadBytes: receipt.document.downloadBytes,
    observedAt,
  });
  const unsigned = Object.freeze({
    schemaVersion: "videoforge.v213-operator-evidence-ingestion-request/v1" as const,
    binding,
    evidence,
    issuedAt,
    nonce,
  });
  return Object.freeze({ ...unsigned, requestSha256: canonicalSha256(unsigned) });
}

export type SubmitV213V212RealChromeEvidence = (input: {
  readonly workerOrigin: string;
  readonly workerOperatorBearer: string;
  readonly request: V213AcceptanceOperatorEvidenceRequest;
  readonly signal: AbortSignal;
}) => Promise<V213AcceptanceOperatorEvidenceResult>;

async function submitEvidence(input: {
  readonly workerOrigin: string;
  readonly workerOperatorBearer: string;
  readonly request: V213AcceptanceOperatorEvidenceRequest;
  readonly signal: AbortSignal;
}): Promise<V213AcceptanceOperatorEvidenceResult> {
  const origin = productionOrigin(input.workerOrigin);
  if (
    input.workerOperatorBearer.trim() !== input.workerOperatorBearer ||
    input.workerOperatorBearer.length < 32
  )
    fail("OPERATOR_BEARER_INVALID");
  const raw = canonicalizeJson(input.request as unknown as JsonValue);
  let response: Response;
  try {
    response = await fetch(`${origin}${V213_ACCEPTANCE_OPERATOR_EVIDENCE_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.workerOperatorBearer}`,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(raw)),
        "x-videoforge-signature": createHmac("sha256", input.workerOperatorBearer)
          .update(raw, "utf8")
          .digest("hex"),
      },
      body: raw,
      signal: input.signal,
    });
  } catch {
    fail("EVIDENCE_INGESTION_AMBIGUOUS");
  }
  if (response.status !== 201 || response.headers.get("cache-control") !== "no-store")
    fail("EVIDENCE_INGESTION_REJECTED");
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    fail("EVIDENCE_RESULT_INVALID");
  }
  const result = parseV213AcceptanceOperatorEvidenceResult(value, input.request);
  if (!result) fail("EVIDENCE_RESULT_INVALID");
  return result;
}

export async function submitV213V212RealChromeEvidence(input: {
  readonly workerOrigin: string;
  readonly workerOperatorBearer: string;
  readonly request: V213AcceptanceOperatorEvidenceRequest;
  readonly signal: AbortSignal;
}): Promise<V213AcceptanceOperatorEvidenceResult> {
  return submitEvidence(input);
}

export async function produceV213V212RealChromeEvidence(input: {
  readonly request: V213V212RealChromeRequest;
  readonly productionOrigin: string;
  readonly workerOrigin: string;
  readonly authStatePath: string;
  readonly workerOperatorBearer: string;
  readonly childSigningKeyFd: number;
  readonly evidenceSigningKey?: Uint8Array;
  readonly evidenceSigningKeyFd?: number;
  readonly spawnJourney: SpawnV213V212RealChromeJourney;
  readonly submit?: SubmitV213V212RealChromeEvidence;
  readonly now?: () => Date;
  readonly nonce?: string;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly request: V213AcceptanceOperatorEvidenceRequest;
  readonly evidence: V213AcceptanceOperatorEvidenceRequest["evidence"];
  readonly childReceipt: V213V212RealChromeChildReceipt;
  readonly verifiedChild: V213V212RealChromeVerifiedChildReceipt;
  readonly ingestion: V213AcceptanceOperatorEvidenceResult;
}> {
  const now = input.now ?? (() => new Date());
  const request = validateV213V212RealChromeRequest(input.request, now());
  if (input.childSigningKeyFd !== V213_V212_REAL_CHROME_CHILD_SIGNING_KEY_FD)
    fail("SIGNING_KEY_FD_INVALID");
  const origin = productionOrigin(input.productionOrigin);
  if (origin !== productionOrigin(input.workerOrigin)) fail("WORKER_ORIGIN_DRIFT");
  if (originSha256(origin) !== request.productionUrlSha256) fail("ORIGIN_HASH_INVALID");
  privateFile(input.authStatePath, "AUTH_STATE_MODE_INVALID");
  const signingKey = readSigningKey(input);
  const controller = new AbortController();
  let journey: V213V212RealChromeJourneyProcess | undefined;
  const onAbort = () => {
    controller.abort();
    journey?.kill("SIGKILL");
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  const deadlineAt = Date.parse(request.deadlineAt);
  const timeout = setTimeout(() => onAbort(), Math.max(1, deadlineAt - now().getTime()));
  try {
    if (input.signal?.aborted) fail("CANCELLED");
    journey = input.spawnJourney({
      request,
      childSigningKeyFd: input.childSigningKeyFd,
      deadlineAt: request.deadlineAt,
      signal: controller.signal,
    });
    const childReceipt = await withDeadline(
      () => journey!.receipt,
      deadlineAt,
      now,
      "DEADLINE_EXCEEDED",
    );
    if (input.signal?.aborted || controller.signal.aborted) fail("CANCELLED");
    const verifiedChild = verifyV213V212RealChromeChildReceipt(
      childReceipt,
      request,
      signingKey,
      now(),
    );
    const operatorRequest = evidenceRequest(
      request,
      childReceipt,
      now(),
      input.nonce ?? `v212-chrome-${randomBytes(24).toString("base64url")}`,
    );
    const ingestion = await withDeadline(
      () =>
        (input.submit ?? submitEvidence)({
          workerOrigin: input.workerOrigin,
          workerOperatorBearer: input.workerOperatorBearer,
          request: operatorRequest,
          signal: controller.signal,
        }),
      deadlineAt,
      now,
      "EVIDENCE_INGESTION_DEADLINE_EXCEEDED",
    );
    return Object.freeze({
      request: operatorRequest,
      evidence: operatorRequest.evidence,
      childReceipt,
      verifiedChild,
      ingestion,
    });
  } catch (error) {
    if (journey && !controller.signal.aborted) journey.kill("SIGKILL");
    if (error instanceof V213V212RealChromeError) throw error;
    return fail("PRODUCER_FAILED");
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onAbort);
  }
}

function protectedChildError(chunks: readonly Buffer[], bytes: number): string | undefined {
  if (bytes < 1 || bytes > CHILD_ERROR_MAX_BYTES) return undefined;
  const value = Buffer.concat(chunks, bytes).toString("utf8").trim();
  return /^V213_V212_REAL_CHROME_[A-Z0-9_]+$/u.test(value) ? value : undefined;
}

export function createV213V212RealChromeJourneySpawner(input: {
  readonly productionOrigin: string;
  readonly authStatePath: string;
  readonly evidenceSigningKey: Uint8Array;
  readonly sourcePins: {
    readonly moduleSha256: Sha256;
    readonly entrySha256: Sha256;
  };
  readonly spawn?: typeof spawnProcess;
}): SpawnV213V212RealChromeJourney {
  const origin = productionOrigin(input.productionOrigin);
  if (input.evidenceSigningKey.byteLength < 32) fail("SIGNING_KEY_INVALID");
  return ({ request, childSigningKeyFd, deadlineAt, signal }) => {
    if (childSigningKeyFd !== V213_V212_REAL_CHROME_CHILD_SIGNING_KEY_FD)
      fail("SIGNING_KEY_FD_INVALID");
    if (!verifyV213V212RealChromeSources(input.sourcePins)) fail("SOURCE_DRIFT");
    const directory = mkdtempSync(join(tmpdir(), "videoforge-v212-chrome-"));
    chmodSync(directory, 0o700);
    const requestPath = join(directory, `${request.workflowId}.request.json`);
    writeFileSync(requestPath, canonicalizeJson(request as unknown as JsonValue), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    chmodSync(requestPath, 0o600);
    const modulePath = sourcePath(
      V213_V212_REAL_CHROME_MODULE_URL,
      "src/server/providers/v213-v212-real-chrome.ts",
    );
    const entryPath = sourcePath(
      V213_V212_REAL_CHROME_ENTRY_URL,
      "src/server/providers/v213-v212-real-chrome-main.ts",
    );
    if (!existsSync(modulePath) || !existsSync(entryPath)) {
      rmSync(directory, { recursive: true, force: true });
      fail("SOURCE_UNAVAILABLE");
    }
    const safeEnvironment: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "PLAYWRIGHT_BROWSERS_PATH"])
      if (process.env[name] !== undefined) safeEnvironment[name] = process.env[name];
    const child = (input.spawn ?? spawnProcess)(
      process.execPath,
      [
        ...process.execArgv,
        entryPath,
        "--request",
        requestPath,
        "--origin",
        origin,
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
      fail("SIGNING_KEY_PIPE_UNAVAILABLE");
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
      if (stderrBytes <= CHILD_ERROR_MAX_BYTES) stderr.push(bytes);
    });
    const receipt = new Promise<V213V212RealChromeChildReceipt>((resolvePromise, reject) => {
      let settled = false;
      const finish = (error?: Error, value?: V213V212RealChromeChildReceipt) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        clearTimeout(timer);
        rmSync(directory, { recursive: true, force: true });
        if (error) reject(error);
        else resolvePromise(value!);
      };
      const abort = () => {
        child.kill("SIGKILL");
        finish(new V213V212RealChromeError(`${V213_V212_REAL_CHROME_ERROR_PREFIX}CANCELLED`));
      };
      const remaining = Date.parse(deadlineAt) - Date.now();
      const timer = setTimeout(
        () => {
          child.kill("SIGKILL");
          finish(
            new V213V212RealChromeError(`${V213_V212_REAL_CHROME_ERROR_PREFIX}DEADLINE_EXCEEDED`),
          );
        },
        Math.max(1, remaining),
      );
      signal.addEventListener("abort", abort, { once: true });
      child.once("error", () =>
        finish(new V213V212RealChromeError(`${V213_V212_REAL_CHROME_ERROR_PREFIX}JOURNEY_FAILED`)),
      );
      child.once("exit", (code) => {
        const childError = protectedChildError(stderr, stderrBytes);
        if (childError) {
          finish(new V213V212RealChromeError(childError));
          return;
        }
        if (code !== 0 || stdoutBytes < 1 || stdoutBytes > MAX_REQUEST_BYTES) {
          finish(
            new V213V212RealChromeError(`${V213_V212_REAL_CHROME_ERROR_PREFIX}JOURNEY_FAILED`),
          );
          return;
        }
        try {
          const value = JSON.parse(Buffer.concat(stdout, stdoutBytes).toString("utf8"));
          finish(undefined, value as V213V212RealChromeChildReceipt);
        } catch {
          finish(
            new V213V212RealChromeError(
              `${V213_V212_REAL_CHROME_ERROR_PREFIX}CHILD_RECEIPT_INVALID`,
            ),
          );
        }
      });
      if (signal.aborted) abort();
    });
    return Object.freeze({ receipt, kill: () => child.kill("SIGKILL") });
  };
}

export function readV213V212RealChromeRequest(
  path: string,
  now: () => Date = () => new Date(),
): V213V212RealChromeRequest {
  return parseRequestFile(path, now);
}

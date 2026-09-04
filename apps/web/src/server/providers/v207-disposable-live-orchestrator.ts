import { createHash, createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { deflateSync } from "node:zlib";

import {
  parseV207ActivationAuthority,
  type V207ActivationAuthority,
} from "./v207-activation-authority";
import {
  extractV207WorkerVersionId,
  spawnV207Command,
  type V207CommandRequest,
  type V207CommandResult,
  type V207CommandRunner,
} from "./v207-live-orchestrator";

export const V207_DISPOSABLE_WORKER_NAME = "videoforge-v207-output" as const;
export const V207_DISPOSABLE_SECRET_NAME = "VIDEOFORGE_V207_AUTHORITY_NONCE" as const;
export const V207_DISPOSABLE_ROUTE =
  "https://videoforge-v207-output.lakshmansai121.workers.dev/api/v2/v207/generated-output-port" as const;
export const V207_DISPOSABLE_CONFIG = "deploy/v2-07/v207-disposable-output.wrangler.jsonc" as const;
export const V207_DISPOSABLE_QUALIFICATION =
  "src/server/providers/v207-live-qualification.ts" as const;

const NONCE = /^[a-f0-9]{64}$/u;
const SAFE_CODE = /^[A-Z][A-Z0-9_.:-]{2,160}$/u;
const ABSENT_DIAGNOSTIC =
  /(?:(?:^|[^\w])(?:code|error\s+code)\s*[:=]\s*(?:10007|10090)(?![A-Za-z0-9_])|["'](?:code|errorCode)["']\s*:\s*(?:10007|10090)(?![A-Za-z0-9_])|\bworker(?:\s+script)?\s+(?:does\s+not\s+exist|not\s+found)\b|\bno\s+such\s+worker\b|\bworkers?\.api\.error\.script[_ -]?not[_ -]?found\b)/iu;
const FINAL_PROOF_READS = 3;
const ROUTE_PROPAGATION_MAX_ATTEMPTS = 30;
const ROUTE_PROPAGATION_MAX_MILLISECONDS = 60_000;
const ROUTE_PROPAGATION_RETRY_MILLISECONDS = 2_000;
const ROUTE_RESPONSE_MAX_BYTES = 4_096;
const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const V207_ROUTE_VERSION_HEADER = "x-videoforge-worker-version" as const;
const PROBE_ACCOUNT_ID = "account-a" as const;
const PROBE_WORKSPACE_ID = "workspace-a" as const;
const PROBE_PROJECT_ID = "project-a" as const;
const PROBE_REVISION_ID = "revision-a" as const;
const PROBE_LIFETIME_SECONDS = 60 as const;
const PROBE_REQUEST_MAX_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MILLISECONDS = 15_000;
const PROBE_CLEANUP_TIMEOUT_MILLISECONDS = 30_000;
const PROBE_RESERVE_MAX_ATTEMPTS = 3;
const PROBE_RESERVE_RETRY_MILLISECONDS = 250;
const PROBE_CLEAN_CYCLES = 3;
const CLEANUP_TIMEOUT_MILLISECONDS = 60_000;
const PYTHON_DIAGNOSTIC_MAX_BYTES = 4_096;
const CAPABILITY_HANDLE = /^[a-f0-9]{64}$/u;
const CHECKSUM = /^sha256:[0-9a-f]{64}$/u;
const PROBE_REQUEST_SCHEMA = "videoforge-v207-generated-output-port-request/v1" as const;

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, body: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + body.byteLength);
  chunk.writeUInt32BE(body.byteLength, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(body).copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(chunk.subarray(4, 8 + body.byteLength)), 8 + body.byteLength);
  return chunk;
}

function qualificationProbePng(): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1280, 0);
  header.writeUInt32BE(720, 4);
  header[8] = 8;
  header[9] = 2;
  const scanlines = Buffer.alloc((1 + 1280 * 3) * 720);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

type Environment = Readonly<Record<string, string | undefined>>;

export interface V207DisposableOrchestratorOptions {
  readonly environment?: Environment;
  readonly authorityParser?: (environment: Environment) => V207ActivationAuthority;
  readonly cwd?: string;
  readonly configPath?: string;
  readonly routeUrl?: string;
  readonly evidencePath?: string;
  readonly commandRunner?: V207CommandRunner;
  readonly fetchImpl?: typeof fetch;
  readonly nonceFactory?: () => string;
  readonly sleepImpl?: (milliseconds: number) => Promise<void>;
  /** Tests may disable process signal registration or provide an isolated signal target. */
  readonly installSignalHandlers?: boolean;
  readonly signalTarget?: Pick<NodeJS.Process, "on" | "off">;
}

export interface V207DisposableOrchestratorResult {
  readonly evidencePath: string;
  readonly qualificationExitCode: 0;
  readonly cleanedUp: true;
}

interface EvidenceEvent {
  readonly event: string;
  readonly at: string;
  readonly [key: string]: string | number | boolean;
}

interface Evidence {
  schema_version: "videoforge-v207-disposable-live-orchestration/v1";
  worker_name: typeof V207_DISPOSABLE_WORKER_NAME;
  route: typeof V207_DISPOSABLE_ROUTE;
  cleanup_required: boolean;
  result: "RUNNING" | "SUCCEEDED" | "FAILED" | "CLEANUP_UNCERTAIN";
  events: EvidenceEvent[];
}

interface RouteFingerprint {
  readonly status: number;
  readonly code: string;
  readonly workerVersionId?: string | null;
}

type RouteStatusClass = "S2XX" | "S3XX" | "S4XX" | "S5XX" | "SOTHER";
type RouteVersionState = "VMATCHED" | "VMISSING" | "VVALID";
type RouteContentClass = "CJSON" | "CMISSING" | "COTHER";
type RouteBodyClass = "BBOUNDED" | "BDECLARED_INVALID" | "BEMPTY" | "BMISMATCH" | "BOVERSIZED";
type ProbeStage = "CLEANUP" | "FINALIZE" | "GET_PORT" | "READBACK" | "RESERVE";
type ProbeLengthClass = "LBOUNDED" | "LEMPTY" | "LINVALID" | "LMISSING" | "LOVERSIZED";
type ProbeVersionFailure = "MALFORMED" | "MISSING" | "WRONG";
type RouteResponseFailure =
  | "BODY_LENGTH_INVALID"
  | "BODY_LENGTH_MISMATCH"
  | "BODY_READ_FAILED"
  | "BODY_TOO_LARGE"
  | "CODE_INVALID"
  | "CODE_MISSING"
  | "CONTENT_TYPE_MISSING"
  | "JSON_INVALID"
  | "NON_JSON"
  | "SHAPE_INVALID";

export class V207DisposableOrchestratorError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "V207DisposableOrchestratorError";
  }
}

class V207RouteResponseError extends V207DisposableOrchestratorError {
  constructor(
    code: string,
    readonly statusClass: RouteStatusClass,
    readonly versionState: RouteVersionState,
  ) {
    super(code);
    this.name = "V207RouteResponseError";
  }
}

class V207ProbeResponseError extends V207DisposableOrchestratorError {
  constructor(
    code: string,
    readonly stage: ProbeStage,
    readonly statusClass: RouteStatusClass,
    readonly versionFailure: ProbeVersionFailure,
  ) {
    super(code);
    this.name = "V207ProbeResponseError";
  }
}

type DisposableSignal = "SIGINT" | "SIGTERM";

/**
 * Install only while the disposable Worker may exist. Returning an idempotent remover keeps the
 * CLI's process-global signal state unchanged after a successful run, a failed run, or cleanup.
 */
function installSignalHandlers(
  target: Pick<NodeJS.Process, "on" | "off">,
  onSignal: (signal: DisposableSignal) => void,
): () => void {
  const registrations: Array<readonly [DisposableSignal, () => void]> = [];
  let removed = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = (): void => onSignal(signal);
    target.on(signal, handler);
    registrations.push([signal, handler]);
  }
  return (): void => {
    if (removed) return;
    removed = true;
    for (const [signal, handler] of registrations) target.off(signal, handler);
  };
}

function safeCode(error: unknown): string {
  if (error instanceof V207DisposableOrchestratorError) return error.code;
  if (error instanceof Error && SAFE_CODE.test(error.message)) return error.message;
  return "V207_DISPOSABLE_UNCLASSIFIED";
}

function redactedEnvironment(environment: Environment): Record<string, string | undefined> {
  const redacted = { ...environment };
  delete redacted.RUNPOD_KEY;
  delete redacted.V207_AUTHORITY_NONCE;
  delete redacted[V207_DISPOSABLE_SECRET_NAME];
  return redacted;
}

function childEnvironment(
  environment: Environment,
  nonce: string,
  configPath: string,
  preflightOnly: boolean,
): Record<string, string | undefined> {
  const child = { ...environment };
  child.V207_WRANGLER_CONFIG = configPath;
  child.V207_AUTHORITY_NONCE = nonce;
  child.V207_OUTPUT_PORT_ROUTE = V207_DISPOSABLE_ROUTE;
  if (preflightOnly) child.V207_PREFLIGHT_ONLY = "1";
  else delete child.V207_PREFLIGHT_ONLY;
  delete child[V207_DISPOSABLE_SECRET_NAME];
  return child;
}

function requireSuccess(code: string, result: V207CommandResult): V207CommandResult {
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new V207DisposableOrchestratorError(code);
  }
  return result;
}

function assertExplicitWorkerName(request: V207CommandRequest): void {
  const nameIndex = request.args.indexOf("--name");
  if (nameIndex < 0 || request.args[nameIndex + 1] !== V207_DISPOSABLE_WORKER_NAME) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_WORKER_NAME_UNBOUND");
  }
}

async function runWrangler(
  run: V207CommandRunner,
  cwd: string,
  configPath: string,
  environment: Environment,
  args: readonly string[],
  stdin?: string,
  signal?: AbortSignal,
): Promise<V207CommandResult> {
  const request: V207CommandRequest = {
    command: "pnpm",
    args: [
      "--filter",
      "@videoforge/web",
      "exec",
      "wrangler",
      ...args,
      "--name",
      V207_DISPOSABLE_WORKER_NAME,
      "--config",
      configPath,
    ],
    cwd,
    env: redactedEnvironment(environment),
    ...(stdin === undefined ? {} : { stdin }),
    ...(signal === undefined ? {} : { signal }),
  };
  assertExplicitWorkerName(request);
  return run(request);
}

async function deleteDisposableWorker(
  run: V207CommandRunner,
  cwd: string,
  configPath: string,
  environment: Environment,
  signal?: AbortSignal,
): Promise<V207CommandResult> {
  const request: V207CommandRequest = {
    command: "pnpm",
    args: [
      "--filter",
      "@videoforge/web",
      "exec",
      "wrangler",
      "delete",
      V207_DISPOSABLE_WORKER_NAME,
      "--force",
      "--config",
      configPath,
    ],
    cwd,
    env: redactedEnvironment(environment),
    ...(signal === undefined ? {} : { signal }),
  };
  if (request.args[5] !== V207_DISPOSABLE_WORKER_NAME) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_DELETE_TARGET_UNBOUND");
  }
  return run(request);
}

function provesWorkerAbsent(result: V207CommandResult): boolean {
  if (result.exitCode === 0 || result.signal !== null) return false;
  const diagnostic = stripVTControlCharacters(
    `${result.stdout.slice(0, 131_072)}\n${result.stderr.slice(0, 131_072)}`,
  );
  return ABSENT_DIAGNOSTIC.test(diagnostic);
}

async function assertWorkerAbsent(
  run: V207CommandRunner,
  cwd: string,
  configPath: string,
  environment: Environment,
  signal?: AbortSignal,
): Promise<void> {
  const result = await runWrangler(
    run,
    cwd,
    configPath,
    environment,
    ["deployments", "status", "--json"],
    undefined,
    signal,
  );
  if (!provesWorkerAbsent(result)) {
    throw new V207DisposableOrchestratorError(
      result.exitCode === 0
        ? "V207_DISPOSABLE_WORKER_PREEXISTING"
        : "V207_DISPOSABLE_WORKER_ABSENCE_UNCONFIRMED",
    );
  }
}

function activeVersionId(result: V207CommandResult): string {
  requireSuccess("V207_DISPOSABLE_STATUS_FAILED", result);
  let value: unknown;
  try {
    value = JSON.parse(result.stdout) as unknown;
  } catch {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_ACTIVE_VERSION_INVALID");
  }
  try {
    return extractV207WorkerVersionId(value);
  } catch {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_ACTIVE_VERSION_INVALID");
  }
}

function assertExpectedWorkerVersion(
  workerVersionId: string | null,
  expectedWorkerVersionId: string,
): void {
  if (workerVersionId === null || !VERSION_ID.test(workerVersionId)) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_ROUTE_VERSION_ID_INVALID");
  }
  if (workerVersionId !== expectedWorkerVersionId) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_ROUTE_VERSION_ID_UNCONFIRMED");
  }
}

function validateObservedWorkerVersion(
  workerVersionId: string | null,
  expectedWorkerVersionId?: string,
): void {
  if (workerVersionId !== null && !VERSION_ID.test(workerVersionId)) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_ROUTE_VERSION_ID_INVALID");
  }
  if (expectedWorkerVersionId !== undefined && workerVersionId !== expectedWorkerVersionId) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_ROUTE_VERSION_ID_UNCONFIRMED");
  }
}

function routeStatusClass(status: number): RouteStatusClass {
  if (status >= 200 && status <= 299) return "S2XX";
  if (status >= 300 && status <= 399) return "S3XX";
  if (status >= 400 && status <= 499) return "S4XX";
  if (status >= 500 && status <= 599) return "S5XX";
  return "SOTHER";
}

function routeVersionState(
  workerVersionId: string | null,
  expectedWorkerVersionId?: string,
): RouteVersionState {
  if (workerVersionId === null) return "VMISSING";
  return expectedWorkerVersionId === workerVersionId ? "VMATCHED" : "VVALID";
}

function routeContentClass(contentType: string | null): RouteContentClass {
  if (contentType === null || contentType.trim() === "") return "CMISSING";
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" ||
    /^application\/[a-z0-9!#$&^_.+-]+\+json$/u.test(mediaType)
    ? "CJSON"
    : "COTHER";
}

function routeResponseError(
  failure: RouteResponseFailure,
  statusClass: RouteStatusClass,
  versionState: RouteVersionState,
  contentClass: RouteContentClass,
  bodyClass: RouteBodyClass,
): V207DisposableOrchestratorError {
  return new V207RouteResponseError(
    `V207_DISPOSABLE_ROUTE_RESPONSE_${failure}_${statusClass}_${versionState}_${contentClass}_${bodyClass}`,
    statusClass,
    versionState,
  );
}

async function readBoundedRouteBody(
  response: Response,
  statusClass: RouteStatusClass,
  versionState: RouteVersionState,
  contentClass: RouteContentClass,
): Promise<{ readonly bytes: Uint8Array; readonly bodyClass: "BBOUNDED" | "BEMPTY" }> {
  const declaredLength = response.headers.get("content-length");
  let expectedLength: number | undefined;
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9][0-9]{0,9})$/u.test(declaredLength)) {
      await response.body?.cancel().catch(() => undefined);
      throw routeResponseError(
        "BODY_LENGTH_INVALID",
        statusClass,
        versionState,
        contentClass,
        "BDECLARED_INVALID",
      );
    }
    expectedLength = Number(declaredLength);
    if (!Number.isSafeInteger(expectedLength) || expectedLength > ROUTE_RESPONSE_MAX_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw routeResponseError(
        "BODY_TOO_LARGE",
        statusClass,
        versionState,
        contentClass,
        "BOVERSIZED",
      );
    }
  }

  const reader = response.body?.getReader();
  if (reader === undefined) {
    if (expectedLength !== undefined && expectedLength !== 0) {
      throw routeResponseError(
        "BODY_LENGTH_MISMATCH",
        statusClass,
        versionState,
        contentClass,
        "BMISMATCH",
      );
    }
    return { bytes: new Uint8Array(), bodyClass: "BEMPTY" };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > ROUTE_RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw routeResponseError(
          "BODY_TOO_LARGE",
          statusClass,
          versionState,
          contentClass,
          "BOVERSIZED",
        );
      }
      chunks.push(item.value);
    }
  } catch (error) {
    if (error instanceof V207DisposableOrchestratorError) throw error;
    throw routeResponseError(
      "BODY_READ_FAILED",
      statusClass,
      versionState,
      contentClass,
      total === 0 ? "BEMPTY" : "BBOUNDED",
    );
  }
  if (expectedLength !== undefined && expectedLength !== total) {
    throw routeResponseError(
      "BODY_LENGTH_MISMATCH",
      statusClass,
      versionState,
      contentClass,
      "BMISMATCH",
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, bodyClass: total === 0 ? "BEMPTY" : "BBOUNDED" };
}

function isRouteResponseDiagnostic(error: V207DisposableOrchestratorError): boolean {
  return error instanceof V207RouteResponseError;
}

function isRetryableActiveRoutePreMatch(error: unknown): boolean {
  return (
    error instanceof V207DisposableOrchestratorError &&
    (error.code === "V207_DISPOSABLE_ROUTE_UNREACHABLE" ||
      (error instanceof V207RouteResponseError &&
        error.statusClass === "S5XX" &&
        error.versionState === "VMATCHED"))
  );
}

async function readRoute(
  fetchImpl: typeof fetch,
  routeUrl: string,
  signal?: AbortSignal,
  timeoutMilliseconds = 15_000,
  expectedWorkerVersionId?: string,
  diagnosticWorkerVersionId?: string,
): Promise<RouteFingerprint> {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(Math.max(1, timeoutMilliseconds));
    response = await fetchImpl(routeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
  } catch {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_ROUTE_UNREACHABLE");
  }
  const workerVersionId = response.headers.get(V207_ROUTE_VERSION_HEADER);
  validateObservedWorkerVersion(workerVersionId, expectedWorkerVersionId);
  const statusClass = routeStatusClass(response.status);
  const versionState = routeVersionState(
    workerVersionId,
    diagnosticWorkerVersionId ?? expectedWorkerVersionId,
  );
  const contentClass = routeContentClass(response.headers.get("content-type"));
  const { bytes, bodyClass } = await readBoundedRouteBody(
    response,
    statusClass,
    versionState,
    contentClass,
  );
  if (contentClass === "CMISSING") {
    throw routeResponseError(
      "CONTENT_TYPE_MISSING",
      statusClass,
      versionState,
      contentClass,
      bodyClass,
    );
  }
  if (contentClass !== "CJSON") {
    throw routeResponseError("NON_JSON", statusClass, versionState, contentClass, bodyClass);
  }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    ) as unknown;
  } catch {
    throw routeResponseError("JSON_INVALID", statusClass, versionState, contentClass, bodyClass);
  }
  const valueRecord =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (valueRecord === null || Array.isArray(valueRecord.error))
    throw routeResponseError("SHAPE_INVALID", statusClass, versionState, contentClass, bodyClass);
  const errorValue = valueRecord.error;
  if (typeof errorValue !== "object" || errorValue === null)
    throw routeResponseError("SHAPE_INVALID", statusClass, versionState, contentClass, bodyClass);
  const errorRecord = errorValue as Record<string, unknown>;
  if (!("code" in errorRecord))
    throw routeResponseError("CODE_MISSING", statusClass, versionState, contentClass, bodyClass);
  const code = errorRecord.code;
  if (typeof code !== "string" || !SAFE_CODE.test(code))
    throw routeResponseError("CODE_INVALID", statusClass, versionState, contentClass, bodyClass);
  return { status: response.status, code, workerVersionId };
}

async function sleepWithSignal(
  sleepImpl: (milliseconds: number) => Promise<void>,
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted === true) {
    throw new V207DisposableOrchestratorError("V207_OPERATOR_ABORT");
  }
  if (signal === undefined) {
    await sleepImpl(milliseconds);
    return;
  }
  await new Promise<void>((resolveSleep, rejectSleep) => {
    const onAbort = (): void => {
      rejectSleep(new V207DisposableOrchestratorError("V207_OPERATOR_ABORT"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void sleepImpl(milliseconds).then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolveSleep();
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        rejectSleep(error);
      },
    );
  });
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

async function assertStableRoute(
  fetchImpl: typeof fetch,
  routeUrl: string,
  expected: RouteFingerprint,
  reads: number,
  sleepImpl: (milliseconds: number) => Promise<void>,
  errorCode: string,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + ROUTE_PROPAGATION_MAX_MILLISECONDS;
  let consecutiveMatches = 0;
  for (let attempt = 1; attempt <= ROUTE_PROPAGATION_MAX_ATTEMPTS; attempt += 1) {
    if (isAborted(signal)) {
      throw new V207DisposableOrchestratorError("V207_OPERATOR_ABORT");
    }
    const remainingMilliseconds = deadline - Date.now();
    if (remainingMilliseconds <= 0) break;
    try {
      const observed = await readRoute(
        fetchImpl,
        routeUrl,
        signal,
        Math.min(15_000, remainingMilliseconds),
        expected.workerVersionId ?? undefined,
      );
      consecutiveMatches =
        observed.status === expected.status &&
        observed.code === expected.code &&
        (expected.workerVersionId === undefined ||
          observed.workerVersionId === expected.workerVersionId)
          ? consecutiveMatches + 1
          : 0;
    } catch (error) {
      if (isAborted(signal)) {
        throw new V207DisposableOrchestratorError("V207_OPERATOR_ABORT");
      }
      if (
        !(error instanceof V207DisposableOrchestratorError) ||
        (error.code !== "V207_DISPOSABLE_ROUTE_UNREACHABLE" && !isRouteResponseDiagnostic(error))
      ) {
        throw error;
      }
      consecutiveMatches = 0;
    }
    if (consecutiveMatches === reads) return;
    if (attempt < ROUTE_PROPAGATION_MAX_ATTEMPTS && Date.now() < deadline) {
      const retryDelayMilliseconds = Math.min(
        ROUTE_PROPAGATION_RETRY_MILLISECONDS,
        Math.max(0, deadline - Date.now()),
      );
      if (retryDelayMilliseconds <= 0) break;
      await sleepWithSignal(sleepImpl, retryDelayMilliseconds, signal);
    }
  }
  throw new V207DisposableOrchestratorError(errorCode);
}

async function assertStableActiveRoute(
  fetchImpl: typeof fetch,
  routeUrl: string,
  expectedWorkerVersionId: string,
  reads: number,
  sleepImpl: (milliseconds: number) => Promise<void>,
  errorCode: string,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + ROUTE_PROPAGATION_MAX_MILLISECONDS;
  let consecutiveMatches = 0;
  let firstExactMatchSeen = false;
  for (let attempt = 1; attempt <= ROUTE_PROPAGATION_MAX_ATTEMPTS; attempt += 1) {
    if (isAborted(signal)) {
      throw new V207DisposableOrchestratorError("V207_OPERATOR_ABORT");
    }
    const remainingMilliseconds = deadline - Date.now();
    if (remainingMilliseconds <= 0) break;
    let observed: RouteFingerprint | undefined;
    try {
      observed = await readRoute(
        fetchImpl,
        routeUrl,
        signal,
        Math.min(15_000, remainingMilliseconds),
        undefined,
        expectedWorkerVersionId,
      );
    } catch (error) {
      if (isAborted(signal)) {
        throw new V207DisposableOrchestratorError("V207_OPERATOR_ABORT");
      }
      if (firstExactMatchSeen || !isRetryableActiveRoutePreMatch(error)) throw error;
      consecutiveMatches = 0;
    }
    if (observed !== undefined) {
      if (typeof observed.workerVersionId !== "string") {
        throw new V207DisposableOrchestratorError("V207_DISPOSABLE_ROUTE_VERSION_ID_INVALID");
      }
      if (observed.status === 403 && observed.code === "V207_AUTHORITY_REJECTED") {
        assertExpectedWorkerVersion(observed.workerVersionId, expectedWorkerVersionId);
        firstExactMatchSeen = true;
        consecutiveMatches += 1;
        if (consecutiveMatches === reads) return;
      } else if (
        // An edge may briefly retain the exact disabled application predecessor after secret put.
        // Once any edge serves the exact active version, regression or alternation is terminal.
        !firstExactMatchSeen &&
        observed.status === 404 &&
        observed.code === "V207_ROUTE_DISABLED" &&
        observed.workerVersionId !== expectedWorkerVersionId
      ) {
        consecutiveMatches = 0;
      } else {
        throw new V207DisposableOrchestratorError(errorCode);
      }
    }
    if (attempt < ROUTE_PROPAGATION_MAX_ATTEMPTS && Date.now() < deadline) {
      const retryDelayMilliseconds = Math.min(
        ROUTE_PROPAGATION_RETRY_MILLISECONDS,
        Math.max(0, deadline - Date.now()),
      );
      if (retryDelayMilliseconds <= 0) break;
      await sleepWithSignal(sleepImpl, retryDelayMilliseconds, signal);
    }
  }
  throw new V207DisposableOrchestratorError(errorCode);
}

async function assertDataPlaneAbsent(
  fetchImpl: typeof fetch,
  routeUrl: string,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(15_000);
    response = await fetchImpl(routeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
  } catch {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_DATA_PLANE_ABSENCE_UNCONFIRMED");
  }
  // A deleted workers.dev script has no application contract to parse. The independent
  // control-plane read proves deletion; this read only proves the public hostname is absent.
  if (response.status !== 404) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_DATA_PLANE_ABSENCE_UNCONFIRMED");
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function probeLengthClass(response: Response): ProbeLengthClass {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength === null) return "LMISSING";
  if (!/^(?:0|[1-9][0-9]{0,9})$/u.test(declaredLength)) return "LINVALID";
  const length = Number(declaredLength);
  if (!Number.isSafeInteger(length)) return "LINVALID";
  if (length === 0) return "LEMPTY";
  return length <= ROUTE_RESPONSE_MAX_BYTES ? "LBOUNDED" : "LOVERSIZED";
}

function invalidProbeVersionError(
  stage: ProbeStage,
  response: Response,
  versionFailure: ProbeVersionFailure,
): V207ProbeResponseError {
  const statusClass = routeStatusClass(response.status);
  return new V207ProbeResponseError(
    `V207_DISPOSABLE_PROBE_${stage}_ROUTE_VERSION_${versionFailure}_${statusClass}_${routeContentClass(response.headers.get("content-type"))}_${probeLengthClass(response)}`,
    stage,
    statusClass,
    versionFailure,
  );
}

function isRetryableReserveFailure(error: unknown): boolean {
  return (
    (error instanceof V207DisposableOrchestratorError &&
      error.code === "V207_DISPOSABLE_PROBE_RESERVE_TRANSPORT_FAILED") ||
    (error instanceof V207ProbeResponseError &&
      error.stage === "RESERVE" &&
      error.statusClass === "S5XX" &&
      error.versionFailure === "MISSING")
  );
}

async function probeRequest(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  stage: ProbeStage,
  expectedWorkerVersionId: string,
  signal?: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MILLISECONDS);
    response = await fetchImpl(input, {
      ...init,
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
  } catch {
    throw new V207DisposableOrchestratorError(`V207_DISPOSABLE_PROBE_${stage}_TRANSPORT_FAILED`);
  }
  const workerVersionId = response.headers.get(V207_ROUTE_VERSION_HEADER);
  if (workerVersionId === null || !VERSION_ID.test(workerVersionId)) {
    const error = invalidProbeVersionError(
      stage,
      response,
      workerVersionId === null ? "MISSING" : "MALFORMED",
    );
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
  if (workerVersionId !== expectedWorkerVersionId) {
    const error = invalidProbeVersionError(stage, response, "WRONG");
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
  return response;
}

async function probeJson(
  fetchImpl: typeof fetch,
  routeUrl: string,
  nonce: string,
  body: Record<string, unknown>,
  stage: Exclude<ProbeStage, "READBACK">,
  expectedWorkerVersionId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded) > PROBE_REQUEST_MAX_BYTES) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_REQUEST_INVALID");
  }
  const response = await probeRequest(
    fetchImpl,
    routeUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-videoforge-v207-authority": nonce,
      },
      body: encoded,
    },
    stage,
    expectedWorkerVersionId,
    signal,
  );
  let value: unknown;
  try {
    value = (await response.json()) as unknown;
  } catch {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_RESPONSE_INVALID");
  }
  const record = recordValue(value);
  if (!response.ok || record === null) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_RESPONSE_REJECTED");
  }
  return record;
}

const PYTHON_URLLIB_PUT = [
  "import base64,json,socket,ssl,sys,urllib.error,urllib.request",
  "allowed_codes={'V207_CAPABILITY_INVALID','V207_CAPABILITY_REJECTED','V207_OUTPUT_ALREADY_EXISTS','V207_OUTPUT_BODY_READ_FAILED','V207_OUTPUT_BUCKET_WRITE_FAILED','V207_OUTPUT_CONFIGURATION_UNAVAILABLE','V207_OUTPUT_FACTS_MISMATCH','V207_OUTPUT_OPERATION_FAILED','V207_OUTPUT_POSTWRITE_HEAD_FAILED','V207_OUTPUT_PREWRITE_HEAD_FAILED','V207_OUTPUT_WRITE_UNCONFIRMED','V207_RESERVATION_EXPIRED','V207_ROUTE_DISABLED'}",
  "def emit(value):",
  "  print(json.dumps(value, separators=(',',':'), sort_keys=True))",
  "def transport_kind(error, depth=0):",
  "  if isinstance(error, (TimeoutError, socket.timeout)): return 'TIMEOUT'",
  "  if isinstance(error, (ssl.SSLCertVerificationError, ssl.CertificateError, ssl.SSLError)): return 'TLS_CERTIFICATE'",
  "  if isinstance(error, urllib.error.URLError):",
  "    reason=getattr(error, 'reason', None)",
  "    if depth < 2 and isinstance(reason, BaseException) and reason is not error: return transport_kind(reason, depth + 1)",
  "    return 'DNS_NETWORK'",
  "  if isinstance(error, (socket.gaierror, ConnectionError, OSError, ValueError)): return 'DNS_NETWORK'",
  "  return 'UNKNOWN'",
  "value=json.load(sys.stdin)",
  "body=base64.b64decode(value['body_base64'], validate=True)",
  "request=urllib.request.Request(value['url'], data=body, method='PUT', headers={'accept':'application/json','user-agent':'VideoForge-Mage/V2-07','content-type':'image/png','content-length':str(len(body))})",
  "try:",
  "  with urllib.request.urlopen(request, timeout=60) as response:",
  "    status=response.status",
  "    version=response.headers.get('x-videoforge-worker-version')",
  "except urllib.error.HTTPError as error:",
  "  status=error.code if isinstance(error.code, int) and 100 <= error.code <= 599 else 0",
  "  version=error.headers.get('x-videoforge-worker-version') if error.headers is not None else None",
  "  worker_code=None",
  "  try:",
  "    raw=error.read(4097)",
  "    if len(raw) <= 4096:",
  "      parsed=json.loads(raw.decode('utf-8'))",
  "      candidate=parsed.get('error',{}).get('code') if isinstance(parsed,dict) and isinstance(parsed.get('error'),dict) else None",
  "      worker_code=candidate if candidate in allowed_codes else None",
  "  except Exception:",
  "    worker_code=None",
  "  emit({'outcome':'HTTP_ERROR','status':status,'worker_error_code':worker_code,'worker_version_id':version})",
  "  raise SystemExit(2)",
  "except Exception as error:",
  "  emit({'outcome':transport_kind(error)})",
  "  raise SystemExit(2)",
  "if status not in (200,201,204): raise SystemExit(3)",
  "emit({'outcome':'SUCCESS','status':status,'worker_version_id':version})",
].join("\n");

const PYTHON_HTTP_WORKER_CODES: Readonly<
  Record<string, { readonly status: number; readonly parentCode: string }>
> = {
  V207_CAPABILITY_INVALID: {
    status: 400,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_CAPABILITY_INVALID",
  },
  V207_CAPABILITY_REJECTED: {
    status: 403,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_CAPABILITY_REJECTED",
  },
  V207_OUTPUT_ALREADY_EXISTS: {
    status: 409,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_OUTPUT_ALREADY_EXISTS",
  },
  V207_OUTPUT_BODY_READ_FAILED: {
    status: 503,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_OUTPUT_BODY_READ_FAILED",
  },
  V207_OUTPUT_BUCKET_WRITE_FAILED: {
    status: 503,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_OUTPUT_BUCKET_WRITE_FAILED",
  },
  V207_OUTPUT_CONFIGURATION_UNAVAILABLE: {
    status: 503,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_OUTPUT_CONFIGURATION_UNAVAILABLE",
  },
  V207_OUTPUT_FACTS_MISMATCH: {
    status: 400,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_OUTPUT_FACTS_MISMATCH",
  },
  V207_OUTPUT_OPERATION_FAILED: {
    status: 503,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_OUTPUT_OPERATION_FAILED",
  },
  V207_OUTPUT_POSTWRITE_HEAD_FAILED: {
    status: 503,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_OUTPUT_POSTWRITE_HEAD_FAILED",
  },
  V207_OUTPUT_PREWRITE_HEAD_FAILED: {
    status: 503,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_OUTPUT_PREWRITE_HEAD_FAILED",
  },
  V207_OUTPUT_WRITE_UNCONFIRMED: {
    status: 503,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_OUTPUT_WRITE_UNCONFIRMED",
  },
  V207_RESERVATION_EXPIRED: {
    status: 409,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_RESERVATION_EXPIRED",
  },
  V207_ROUTE_DISABLED: {
    status: 404,
    parentCode: "V207_DISPOSABLE_PROBE_URLLIB_ROUTE_DISABLED",
  },
};

function exactDiagnosticKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return Object.keys(record).sort().join(",") === [...expected].sort().join(",");
}

function pythonHttpClassCode(status: number): string {
  if (status >= 400 && status <= 499) return "V207_DISPOSABLE_PROBE_URLLIB_HTTP_4XX";
  if (status >= 500 && status <= 599) return "V207_DISPOSABLE_PROBE_URLLIB_HTTP_5XX";
  return "V207_DISPOSABLE_PROBE_URLLIB_HTTP_OTHER";
}

function assertExpectedPythonWorkerVersion(
  workerVersionId: unknown,
  expectedWorkerVersionId: string,
  status: number,
): void {
  const statusClass = routeStatusClass(status);
  if (workerVersionId === null) {
    throw new V207DisposableOrchestratorError(
      `V207_DISPOSABLE_PROBE_URLLIB_VERSION_MISSING_${statusClass}`,
    );
  }
  if (typeof workerVersionId !== "string" || !VERSION_ID.test(workerVersionId)) {
    throw new V207DisposableOrchestratorError(
      `V207_DISPOSABLE_PROBE_URLLIB_VERSION_MALFORMED_${statusClass}`,
    );
  }
  if (workerVersionId !== expectedWorkerVersionId) {
    throw new V207DisposableOrchestratorError(
      `V207_DISPOSABLE_PROBE_URLLIB_VERSION_WRONG_${statusClass}`,
    );
  }
}

/** Execute the same urllib PUT used by the immutable Mage runtime without exposing transport data. */
export async function runV207PythonUrllibPutProbe(
  run: V207CommandRunner,
  cwd: string,
  environment: Environment,
  url: string,
  body: Buffer,
  expectedWorkerVersionId: string,
  signal?: AbortSignal,
): Promise<void> {
  const result = await run({
    command: "python3",
    args: ["-c", PYTHON_URLLIB_PUT],
    cwd,
    env: redactedEnvironment(environment),
    stdin: JSON.stringify({ url, body_base64: body.toString("base64") }),
    ...(signal === undefined ? {} : { signal }),
  });
  if (result.signal !== null) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_URLLIB_UPLOAD_REJECTED");
  }
  const stdout = result.stdout.trim();
  if (
    stdout.length === 0 ||
    Buffer.byteLength(stdout) > PYTHON_DIAGNOSTIC_MAX_BYTES ||
    Buffer.byteLength(result.stderr) !== 0
  ) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_URLLIB_DIAGNOSTIC_INVALID");
  }
  let value: unknown;
  try {
    value = JSON.parse(stdout) as unknown;
  } catch {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_URLLIB_DIAGNOSTIC_INVALID");
  }
  const record = recordValue(value);
  if (record === null || typeof record.outcome !== "string") {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_URLLIB_DIAGNOSTIC_INVALID");
  }
  if (record.outcome === "SUCCESS") {
    if (
      result.exitCode !== 0 ||
      !exactDiagnosticKeys(record, ["outcome", "status", "worker_version_id"]) ||
      (record.status !== 200 && record.status !== 201 && record.status !== 204)
    ) {
      throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_URLLIB_DIAGNOSTIC_INVALID");
    }
    assertExpectedPythonWorkerVersion(
      record.worker_version_id,
      expectedWorkerVersionId,
      record.status,
    );
    return;
  }
  if (result.exitCode !== 2) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_URLLIB_DIAGNOSTIC_INVALID");
  }
  if (record.outcome === "HTTP_ERROR") {
    if (
      !exactDiagnosticKeys(record, [
        "outcome",
        "status",
        "worker_error_code",
        "worker_version_id",
      ]) ||
      typeof record.status !== "number" ||
      !Number.isSafeInteger(record.status) ||
      record.status < 100 ||
      record.status > 599 ||
      (record.worker_error_code !== null && typeof record.worker_error_code !== "string")
    ) {
      throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_URLLIB_DIAGNOSTIC_INVALID");
    }
    assertExpectedPythonWorkerVersion(
      record.worker_version_id,
      expectedWorkerVersionId,
      record.status,
    );
    const mapped =
      typeof record.worker_error_code === "string"
        ? PYTHON_HTTP_WORKER_CODES[record.worker_error_code]
        : undefined;
    if (mapped !== undefined) {
      if (record.status !== mapped.status) {
        throw new V207DisposableOrchestratorError(
          "V207_DISPOSABLE_PROBE_URLLIB_DIAGNOSTIC_INVALID",
        );
      }
      throw new V207DisposableOrchestratorError(mapped.parentCode);
    }
    if (record.worker_error_code !== null) {
      throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_URLLIB_DIAGNOSTIC_INVALID");
    }
    throw new V207DisposableOrchestratorError(pythonHttpClassCode(record.status));
  }
  if (!exactDiagnosticKeys(record, ["outcome"])) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_URLLIB_DIAGNOSTIC_INVALID");
  }
  const transportCode =
    record.outcome === "TIMEOUT"
      ? "V207_DISPOSABLE_PROBE_URLLIB_TIMEOUT"
      : record.outcome === "TLS_CERTIFICATE"
        ? "V207_DISPOSABLE_PROBE_URLLIB_TLS_CERTIFICATE"
        : record.outcome === "DNS_NETWORK"
          ? "V207_DISPOSABLE_PROBE_URLLIB_DNS_NETWORK"
          : record.outcome === "UNKNOWN"
            ? "V207_DISPOSABLE_PROBE_URLLIB_UNKNOWN"
            : null;
  if (transportCode === null) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_URLLIB_DIAGNOSTIC_INVALID");
  }
  throw new V207DisposableOrchestratorError(transportCode);
}

async function runOutputCompatibilityProbe(
  fetchImpl: typeof fetch,
  routeUrl: string,
  nonce: string,
  run: V207CommandRunner,
  cwd: string,
  environment: Environment,
  expectedWorkerVersionId: string,
  cycle: 1 | 2 | 3,
  sleepImpl: (milliseconds: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const png = qualificationProbePng();
  const jobId = `pregpu-cycle-${cycle}`;
  const objectKey =
    `tenant/${PROBE_ACCOUNT_ID}/workspace/${PROBE_WORKSPACE_ID}/project/${PROBE_PROJECT_ID}` +
    `/revision/${PROBE_REVISION_ID}/lane/mage-image/job/${jobId}/artifact/probe.png`;
  const scope = {
    schema_version: PROBE_REQUEST_SCHEMA,
    account_id: PROBE_ACCOUNT_ID,
    workspace_id: PROBE_WORKSPACE_ID,
    object_key: objectKey,
    content_type: "image/png",
  } as const;
  let cleanupArmed = false;
  let primaryError: unknown;
  let cleanupError: unknown;
  try {
    // The reservation key is deterministic. Arm DELETE before POST so an accepted request with a
    // lost/invalid response is still rolled back.
    cleanupArmed = true;
    const reserveRequest = {
      ...scope,
      operation: "PUT",
      max_content_length: png.byteLength,
      lifetime_seconds: PROBE_LIFETIME_SECONDS,
    } as const;
    let port: Record<string, unknown> | undefined;
    for (let attempt = 1; attempt <= PROBE_RESERVE_MAX_ATTEMPTS; attempt += 1) {
      try {
        port = await probeJson(
          fetchImpl,
          routeUrl,
          nonce,
          reserveRequest,
          "RESERVE",
          expectedWorkerVersionId,
          signal,
        );
        break;
      } catch (error) {
        if (attempt === PROBE_RESERVE_MAX_ATTEMPTS || !isRetryableReserveFailure(error)) {
          throw error;
        }
        // PUT reservation identity is deterministic from nonce + exact object key, and the Worker
        // accepts only an exact sameReservation replay. Cleanup was armed before the first request.
        await sleepWithSignal(sleepImpl, PROBE_RESERVE_RETRY_MILLISECONDS, signal);
      }
    }
    if (port === undefined) {
      throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_RESERVE_UNCONFIRMED");
    }
    const authority = recordValue(port.authority);
    const putUrl = port.url;
    const reservationId = authority?.reservation_id;
    const finalizeCapability = authority?.capability_handle;
    if (
      port.operation !== "PUT" ||
      port.method !== "PUT" ||
      typeof putUrl !== "string" ||
      !putUrl.startsWith(`${routeUrl}?`) ||
      typeof reservationId !== "string" ||
      typeof finalizeCapability !== "string" ||
      !CAPABILITY_HANDLE.test(finalizeCapability)
    ) {
      throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_PORT_INVALID");
    }
    await runV207PythonUrllibPutProbe(
      run,
      cwd,
      environment,
      putUrl,
      png,
      expectedWorkerVersionId,
      signal,
    );
    const checksum = `sha256:${createHash("sha256").update(png).digest("hex")}`;
    if (!CHECKSUM.test(checksum)) {
      throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_CHECKSUM_INVALID");
    }
    await probeJson(
      fetchImpl,
      routeUrl,
      nonce,
      {
        ...scope,
        operation: "FINALIZE",
        reservation_id: reservationId,
        callback_id: `pregpu-probe-cycle-${cycle}`,
        capability_handle: finalizeCapability,
        content_length: png.byteLength,
        checksum_sha256: checksum,
      },
      "FINALIZE",
      expectedWorkerVersionId,
      signal,
    );
    const getPort = await probeJson(
      fetchImpl,
      routeUrl,
      nonce,
      {
        ...scope,
        operation: "GET",
        max_content_length: png.byteLength,
        lifetime_seconds: PROBE_LIFETIME_SECONDS,
        content_length: png.byteLength,
        checksum_sha256: checksum,
      },
      "GET_PORT",
      expectedWorkerVersionId,
      signal,
    );
    if (
      getPort.operation !== "GET" ||
      getPort.method !== "GET" ||
      typeof getPort.url !== "string"
    ) {
      throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_GET_PORT_INVALID");
    }
    const readback = await probeRequest(
      fetchImpl,
      getPort.url,
      { method: "GET" },
      "READBACK",
      expectedWorkerVersionId,
      signal,
    );
    const readbackBytes = Buffer.from(await readback.arrayBuffer());
    if (
      readback.status !== 200 ||
      readbackBytes.byteLength !== png.byteLength ||
      !readbackBytes.equals(png)
    ) {
      throw new V207DisposableOrchestratorError("V207_DISPOSABLE_PROBE_READBACK_MISMATCH");
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (cleanupArmed) {
      const cleanupSignal = AbortSignal.timeout(PROBE_CLEANUP_TIMEOUT_MILLISECONDS);
      try {
        const deleted = await probeJson(
          fetchImpl,
          routeUrl,
          nonce,
          {
            schema_version: PROBE_REQUEST_SCHEMA,
            account_id: PROBE_ACCOUNT_ID,
            workspace_id: PROBE_WORKSPACE_ID,
            object_key: objectKey,
            operation: "DELETE",
            rollback_token: createHmac("sha256", nonce).update(objectKey).digest("hex"),
          },
          "CLEANUP",
          expectedWorkerVersionId,
          cleanupSignal,
        );
        if (deleted.operation !== "DELETE" || deleted.deleted !== true) {
          cleanupError = new V207DisposableOrchestratorError(
            "V207_DISPOSABLE_PROBE_CLEANUP_UNCONFIRMED",
          );
        }
      } catch {
        cleanupError = new V207DisposableOrchestratorError(
          "V207_DISPOSABLE_PROBE_CLEANUP_UNCONFIRMED",
        );
      }
    }
  }
  if (cleanupError !== undefined) throw cleanupError;
  if (primaryError !== undefined) throw primaryError;
}

async function atomicEvidence(path: string, evidence: Evidence): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

/**
 * Qualify V2-07 through a newly-created, fixed-name disposable Worker. This never reads,
 * deploys, rolls back, or deletes the staging Worker. An exact absence proof is required before
 * the durable cleanup intent is written and before the first remote mutation.
 */
export async function runV207DisposableLiveOrchestration(
  options: V207DisposableOrchestratorOptions = {},
): Promise<V207DisposableOrchestratorResult> {
  const environment = options.environment ?? process.env;
  (options.authorityParser ?? parseV207ActivationAuthority)(environment);
  const cwd = resolve(options.cwd ?? (process.cwd().endsWith("/apps/web") ? "../.." : "."));
  const configPath = resolve(cwd, options.configPath ?? V207_DISPOSABLE_CONFIG);
  const routeUrl = options.routeUrl ?? V207_DISPOSABLE_ROUTE;
  if (routeUrl !== V207_DISPOSABLE_ROUTE) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_ROUTE_MISMATCH");
  }
  const evidencePath = resolve(options.evidencePath ?? "/tmp/videoforge-v207-disposable.json");
  const run = options.commandRunner ?? spawnV207Command;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl =
    options.sleepImpl ?? ((milliseconds) => new Promise((done) => setTimeout(done, milliseconds)));
  const nonce = (options.nonceFactory ?? (() => randomBytes(32).toString("hex")))();
  if (!NONCE.test(nonce)) throw new V207DisposableOrchestratorError("V207_NONCE_INVALID");
  const qualificationCommand = resolve(cwd, "apps/web/node_modules/.bin/tsx");
  const qualificationCwd = resolve(cwd, "apps/web");
  const evidence: Evidence = {
    schema_version: "videoforge-v207-disposable-live-orchestration/v1",
    worker_name: V207_DISPOSABLE_WORKER_NAME,
    route: V207_DISPOSABLE_ROUTE,
    cleanup_required: false,
    result: "RUNNING",
    events: [],
  };
  const record = async (event: string, detail: Record<string, string | number | boolean> = {}) => {
    evidence.events.push({ event, at: new Date().toISOString(), ...detail });
    await atomicEvidence(evidencePath, evidence);
  };

  let mutationAttempted = false;
  let primaryError: unknown;
  let cleanupUncertain = false;
  const abortController = new AbortController();
  let abortRequested = false;
  let receivedSignal: DisposableSignal | undefined;
  let removeSignalHandlers: (() => void) | undefined;
  const clean = requireSuccess(
    "V207_GIT_STATUS_FAILED",
    await run({
      command: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd,
      env: redactedEnvironment(environment),
    }),
  );
  if (clean.stdout.trim() !== "")
    throw new V207DisposableOrchestratorError("V207_GIT_WORKTREE_DIRTY");
  await record("clean_worktree_confirmed");

  const preflight = await run({
    command: qualificationCommand,
    args: [V207_DISPOSABLE_QUALIFICATION],
    cwd: qualificationCwd,
    env: childEnvironment(environment, nonce, configPath, true),
  });
  requireSuccess("V207_LIVE_PREFLIGHT", preflight);
  await record("preflight_completed");

  try {
    await assertWorkerAbsent(run, cwd, configPath, environment);
  } catch (error) {
    // This is still the read-only admission boundary. Persist a terminal result before
    // returning the provider diagnostic so an absence-parser drift cannot leave evidence in
    // RUNNING, and do not enter the mutation cleanup path for a Worker that was never created.
    evidence.cleanup_required = false;
    evidence.result = "FAILED";
    await record("initial_control_plane_absence_rejected_before_mutation", {
      code: safeCode(error),
    });
    throw error;
  }
  await record("initial_control_plane_absence_confirmed");

  try {
    if (options.installSignalHandlers !== false) {
      removeSignalHandlers = installSignalHandlers(options.signalTarget ?? process, (signal) => {
        receivedSignal = signal;
        abortRequested = true;
        abortController.abort();
      });
    }
    evidence.cleanup_required = true;
    // Treat the remote boundary as potentially mutated from this point onward. This is
    // intentionally conservative: if the signal arrives while the durable intent is being
    // written, finally still executes the bounded delete/proof sequence.
    mutationAttempted = true;
    await record("cleanup_intent_persisted");
    requireSuccess(
      "V207_DISPOSABLE_DEPLOY_FAILED",
      await runWrangler(
        run,
        cwd,
        configPath,
        environment,
        ["deploy"],
        undefined,
        abortController.signal,
      ),
    );
    await record("signer_disabled_worker_deployed");

    await assertStableRoute(
      fetchImpl,
      routeUrl,
      { status: 404, code: "V207_ROUTE_DISABLED" },
      FINAL_PROOF_READS,
      sleepImpl,
      "V207_DISPOSABLE_DISABLED_ROUTE_UNCONFIRMED",
      abortController.signal,
    );
    await record("disabled_route_confirmed", { reads: FINAL_PROOF_READS });

    requireSuccess(
      "V207_DISPOSABLE_SECRET_PUT_FAILED",
      await runWrangler(
        run,
        cwd,
        configPath,
        environment,
        ["secret", "put", V207_DISPOSABLE_SECRET_NAME],
        `${nonce}\n`,
        abortController.signal,
      ),
    );
    const versionId = activeVersionId(
      await runWrangler(
        run,
        cwd,
        configPath,
        environment,
        ["deployments", "status", "--json"],
        undefined,
        abortController.signal,
      ),
    );
    await record("active_version_confirmed", { version_id_present: versionId.length > 0 });

    await assertStableActiveRoute(
      fetchImpl,
      routeUrl,
      versionId,
      FINAL_PROOF_READS,
      sleepImpl,
      "V207_DISPOSABLE_ACTIVE_ROUTE_UNCONFIRMED",
      abortController.signal,
    );
    await record("active_route_confirmed", { reads: FINAL_PROOF_READS });

    for (const cycle of [1, 2, 3] as const) {
      await runOutputCompatibilityProbe(
        fetchImpl,
        routeUrl,
        nonce,
        run,
        cwd,
        environment,
        versionId,
        cycle,
        sleepImpl,
        abortController.signal,
      );
      await record("pre_gpu_output_compatibility_probe_cycle_completed", { cycle });
    }
    await record("pre_gpu_output_compatibility_probe_completed", {
      clean_cycles: PROBE_CLEAN_CYCLES,
    });

    const qualification = await run({
      command: qualificationCommand,
      args: [V207_DISPOSABLE_QUALIFICATION],
      cwd: qualificationCwd,
      env: childEnvironment(environment, nonce, configPath, false),
      signal: abortController.signal,
    });
    requireSuccess("V207_LIVE_RUNNER_FAILED", qualification);
    if (abortRequested) throw new V207DisposableOrchestratorError("V207_OPERATOR_ABORT");
    await record("qualification_completed", { exit_code: 0 });
  } catch (error) {
    primaryError = abortRequested
      ? new V207DisposableOrchestratorError("V207_OPERATOR_ABORT")
      : error;
    await record(abortRequested ? "orchestration_cancelled" : "orchestration_failed", {
      code: safeCode(primaryError),
      ...(receivedSignal === undefined ? {} : { signal: receivedSignal }),
    });
  } finally {
    try {
      if (mutationAttempted) {
        try {
          const cleanupSignal = AbortSignal.timeout(CLEANUP_TIMEOUT_MILLISECONDS);
          requireSuccess(
            "V207_DISPOSABLE_DELETE_FAILED",
            await deleteDisposableWorker(run, cwd, configPath, environment, cleanupSignal),
          );
          for (let read = 1; read <= FINAL_PROOF_READS; read += 1) {
            await assertWorkerAbsent(run, cwd, configPath, environment, cleanupSignal);
            await assertDataPlaneAbsent(fetchImpl, routeUrl, cleanupSignal);
            if (read < FINAL_PROOF_READS) await sleepImpl(2_000);
          }
          evidence.cleanup_required = false;
          await record("cleanup_confirmed", { reads: FINAL_PROOF_READS });
        } catch (cleanupError) {
          cleanupUncertain = true;
          evidence.result = "CLEANUP_UNCERTAIN";
          await record("cleanup_uncertain", { code: safeCode(cleanupError) });
        }
      }
    } finally {
      const remove = removeSignalHandlers;
      removeSignalHandlers = undefined;
      remove?.();
    }
  }

  if (cleanupUncertain) {
    throw new V207DisposableOrchestratorError("V207_CLEANUP_UNCERTAIN");
  }

  // A signal can arrive during the bounded cleanup reads, after the primary lifecycle has
  // returned successfully. Keep that run cancelled rather than reporting success, while still
  // letting the cleanup proof finish and the handlers be removed above.
  if (abortRequested && primaryError === undefined) {
    evidence.result = "FAILED";
    await record("orchestration_cancelled", {
      code: "V207_OPERATOR_ABORT",
      ...(receivedSignal === undefined ? {} : { signal: receivedSignal }),
    });
    throw new V207DisposableOrchestratorError("V207_OPERATOR_ABORT");
  }

  if (primaryError !== undefined) {
    evidence.result = "FAILED";
    await atomicEvidence(evidencePath, evidence);
    throw primaryError;
  }
  evidence.result = "SUCCEEDED";
  await record("orchestration_complete", { cleaned_up: true });
  return { evidencePath, qualificationExitCode: 0, cleanedUp: true };
}

async function main(): Promise<void> {
  try {
    await runV207DisposableLiveOrchestration();
  } catch (error) {
    console.error(safeCode(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1]?.endsWith("/v207-disposable-live-orchestrator.ts") ||
  process.argv[1]?.endsWith("/v207-disposable-live-orchestrator.js")
) {
  void main();
}

import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, lstat, mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { parseV207ActivationAuthority } from "./v207-activation-authority";

export const V207_ORCHESTRATOR_WORKER_NAME = "videoforge-v2-06-staging" as const;
export const V207_ORCHESTRATOR_SECRET_NAME = "VIDEOFORGE_V207_AUTHORITY_NONCE" as const;
export const V207_ORCHESTRATOR_ROUTE =
  "https://videoforge-v2-06-staging.lakshmansai121.workers.dev/api/v2/v207/generated-output-port" as const;
export const V207_ORCHESTRATOR_DEFAULT_WRANGLER_CONFIG =
  "/Users/lakshmansai/.config/videoforge/v2-06/wrangler-current-3d8d467.json" as const;

const REPOSITORY_ROOT = process.cwd().endsWith("/apps/web")
  ? resolve(process.cwd(), "../..")
  : resolve(process.cwd());
const MAX_CAPTURE_BYTES = 128 * 1024;
const ACTIVATION_PROPAGATION_MAX_ATTEMPTS = 30;
const ACTIVATION_PROPAGATION_DELAY_MS = 2_000;
const ACTIVATION_PROPAGATION_WINDOW_MS = 60_000;
const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NONCE = /^[a-f0-9]{64}$/u;
const SOURCE_COMMIT = /^[0-9a-f]{40}$/u;
export const V207_ORCHESTRATOR_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;

type Environment = Readonly<Record<string, string | undefined>>;

export interface V207CommandRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin?: string;
  readonly signal?: AbortSignal;
}

export interface V207CommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type V207CommandRunner = (request: V207CommandRequest) => Promise<V207CommandResult>;

export interface V207LiveOrchestratorOptions {
  /** Test-only dependency injection; production uses process.env. */
  readonly environment?: Environment;
  readonly cwd?: string;
  readonly configPath?: string;
  readonly routeUrl?: string;
  readonly evidencePath?: string;
  readonly commandRunner?: V207CommandRunner;
  readonly fetchImpl?: typeof fetch;
  readonly nonceFactory?: () => string;
  /** Test-only dependency injection for the bounded secret-propagation poll. */
  readonly sleepImpl?: (milliseconds: number) => Promise<void>;
  /** Tests disable process signal registration; production leaves it enabled. */
  readonly installSignalHandlers?: boolean;
}

export interface V207LiveOrchestratorResult {
  readonly evidencePath: string;
  readonly capturedVersionIdHash: string;
  readonly runnerExitCode: number;
  readonly cleanedUp: true;
}

export function assertV207DiskHeadroom(availableBytes: number): void {
  if (!Number.isSafeInteger(availableBytes) || availableBytes < V207_ORCHESTRATOR_MIN_FREE_BYTES) {
    throw new V207LiveOrchestratorError("V207_LOCAL_DISK_HEADROOM_INSUFFICIENT");
  }
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

interface EvidenceEvent {
  readonly event: string;
  readonly at: string;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

interface RouteFingerprint {
  readonly status: number;
  readonly code: string;
}

interface EvidenceDocument {
  readonly schema_version: "videoforge-v207-live-orchestrator/v1";
  readonly worker_name: typeof V207_ORCHESTRATOR_WORKER_NAME;
  readonly route: typeof V207_ORCHESTRATOR_ROUTE | string;
  readonly config_path: string;
  readonly authority: {
    readonly image_digest: string;
    readonly source_commit: string;
    readonly cap_usd: number;
  };
  readonly events: EvidenceEvent[];
  result: "RUNNING" | "SUCCEEDED" | "FAILED" | "CLEANUP_UNCERTAIN";
}

export class V207LiveOrchestratorError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "V207LiveOrchestratorError";
    this.code = code;
  }
}

const isoNow = (): string => new Date().toISOString();

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function imageDigest(image: string): string {
  const at = image.lastIndexOf("@");
  if (at < 0) throw new V207LiveOrchestratorError("V207_IMAGE_DIGEST_REQUIRED");
  return image.slice(at + 1);
}

function safeErrorCode(error: unknown): string {
  const candidate =
    error instanceof V207LiveOrchestratorError
      ? error.code
      : error instanceof Error && /^[A-Z][A-Z0-9_.:-]{2,160}$/u.test(error.message)
        ? error.message
        : "V207_ORCHESTRATOR_FAILED";
  return /^[A-Z][A-Z0-9_.:-]{2,160}$/u.test(candidate) ? candidate : "V207_ORCHESTRATOR_FAILED";
}

function redactEnvironment(environment: Environment): Record<string, string | undefined> {
  const redacted = { ...environment };
  for (const key of ["RUNPOD_KEY", "V207_AUTHORITY_NONCE", V207_ORCHESTRATOR_SECRET_NAME]) {
    delete redacted[key];
  }
  return redacted;
}

function appendChunk(
  current: string,
  chunk: Buffer | string,
): { readonly value: string; readonly truncated: boolean } {
  const incoming = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const remaining = MAX_CAPTURE_BYTES - Buffer.byteLength(current, "utf8");
  if (remaining <= 0) return { value: current, truncated: true };
  const bytes = Buffer.from(incoming, "utf8");
  if (bytes.byteLength <= remaining) return { value: `${current}${incoming}`, truncated: false };
  return { value: `${current}${bytes.subarray(0, remaining).toString("utf8")}`, truncated: true };
}

/** Run a child process with all output captured and never forwarded to the terminal. */
export const spawnV207Command: V207CommandRunner = async (
  request: V207CommandRequest,
): Promise<V207CommandResult> =>
  await new Promise<V207CommandResult>((resolveResult, rejectResult) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      rejectResult(new V207LiveOrchestratorError("V207_COMMAND_SPAWN_FAILED"));
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    child.stdout.on("data", (chunk: Buffer | string) => {
      const next = appendChunk(stdout, chunk);
      stdout = next.value;
      stdoutTruncated ||= next.truncated;
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const next = appendChunk(stderr, chunk);
      stderr = next.value;
      stderrTruncated ||= next.truncated;
    });
    const abort = (): void => {
      if (!child.killed) child.kill("SIGTERM");
    };
    if (request.signal?.aborted) abort();
    else request.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", () => {
      request.signal?.removeEventListener("abort", abort);
      rejectResult(new V207LiveOrchestratorError("V207_COMMAND_EXECUTION_FAILED"));
    });
    child.once("close", (exitCode, signal) => {
      request.signal?.removeEventListener("abort", abort);
      // Truncation is intentionally not persisted or printed. It only prevents unbounded memory
      // growth when a provider diagnostic is unexpectedly verbose.
      void stdoutTruncated;
      void stderrTruncated;
      resolveResult({
        exitCode,
        signal,
        stdout,
        stderr,
      });
    });
    child.stdin.end(request.stdin ?? "");
  });

function requireSuccessful(label: string, result: V207CommandResult): V207CommandResult {
  if (result.exitCode !== 0) {
    throw new V207LiveOrchestratorError(`${label}_FAILED`);
  }
  return result;
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) throw new V207LiveOrchestratorError("V207_JSON_OUTPUT_EMPTY");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const starts = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter((index) => index >= 0);
    const start = Math.min(...starts);
    const ends = [trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]")];
    const end = Math.max(...ends);
    if (!Number.isSafeInteger(start) || start < 0 || end <= start) {
      throw new V207LiveOrchestratorError("V207_JSON_OUTPUT_INVALID");
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      throw new V207LiveOrchestratorError("V207_JSON_OUTPUT_INVALID");
    }
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

/**
 * Extract the active Cloudflare Worker version UUID from Wrangler status JSON.
 *
 * `wrangler deployments status --json` returns a deployment envelope whose `id`
 * is a deployment ID, not a Worker version ID. The version to pass to
 * `wrangler rollback` is nested under `versions[].version_id` (normally with
 * `percentage: 100`). Treating the envelope ID as the version makes rollback
 * fail after the Worker has already been mutated, which leaves cleanup
 * incorrectly reported as uncertain. Prefer explicit/active version fields and
 * only accept a bare `id` when no deployment `versions` collection is present.
 */
export function extractV207WorkerVersionId(value: unknown): string {
  const versionKeys = [
    "version_id",
    "versionId",
    "current_version_id",
    "currentVersionId",
    "latest_version_id",
    "latestVersionId",
    "active_version_id",
    "activeVersionId",
  ] as const;
  const versionKeySet = new Set<string>(versionKeys);

  const readVersionField = (record: JsonRecord): string | null => {
    for (const key of versionKeys) {
      const candidate = record[key];
      if (typeof candidate === "string" && VERSION_ID.test(candidate)) return candidate;
    }
    return null;
  };

  const versionFromEntry = (entry: unknown): string | null => {
    const record = asRecord(entry);
    if (!record) return null;
    // A versions entry is expected to carry version_id. Never fall back to its
    // generic id field: that field is a deployment id in Wrangler envelopes.
    return readVersionField(record);
  };

  const activeVersionFromList = (entries: unknown[]): string | null => {
    const records = entries.filter((entry): entry is JsonRecord => asRecord(entry) !== null);
    if (records.length === 0) return null;
    const active = records.filter((record) => {
      if (record.is_active === true || record.active === true) return true;
      const percentage = Number(record.percentage ?? record.traffic_percent);
      return Number.isFinite(percentage) && percentage === 100;
    });
    const candidates = active.length === 1 ? active : records.length === 1 ? records : [];
    if (candidates.length !== 1) return null;
    return versionFromEntry(candidates[0]);
  };

  const visit = (candidate: unknown): string | null => {
    if (Array.isArray(candidate)) {
      // Arrays at the root are commonly the deployments list. Examine each
      // envelope independently so an envelope's `id` never wins over its
      // nested active version.
      for (const entry of candidate) {
        const found = visit(entry);
        if (found) return found;
      }
      return null;
    }
    const record = asRecord(candidate);
    if (!record) return null;

    const explicit = readVersionField(record);
    if (explicit) return explicit;

    if (Array.isArray(record.versions)) {
      const active = activeVersionFromList(record.versions);
      if (active) return active;
      // An envelope with an ambiguous/malformed versions list must not fall
      // through to its deployment id. Continue only into non-id metadata.
      for (const [key, entry] of Object.entries(record)) {
        if (key === "id" || key === "versions" || versionKeySet.has(key)) continue;
        const found = visit(entry);
        if (found) return found;
      }
      return null;
    }

    // Wrangler's status command can also emit a bare `{ id: <version> }` in
    // older/alternate shapes. This fallback is safe only without a deployment
    // versions collection (handled above).
    if (typeof record.id === "string" && VERSION_ID.test(record.id)) return record.id;

    for (const [key, entry] of Object.entries(record)) {
      if (versionKeySet.has(key) || key === "id") continue;
      const found = visit(entry);
      if (found) return found;
    }
    return null;
  };

  const found = visit(value);
  if (!found) throw new V207LiveOrchestratorError("V207_WORKER_VERSION_ID_MISSING");
  return found;
}

function parseSecretNames(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new V207LiveOrchestratorError("V207_SECRET_LIST_INVALID");
  const names = value.map((entry) => {
    const record = asRecord(entry);
    if (
      !record ||
      typeof record.name !== "string" ||
      !/^[A-Za-z0-9_:-]{1,128}$/u.test(record.name)
    ) {
      throw new V207LiveOrchestratorError("V207_SECRET_LIST_INVALID");
    }
    return record.name;
  });
  return Object.freeze([...new Set(names)].sort());
}

async function readProtectedConfig(configPath: string): Promise<JsonRecord> {
  if (!isAbsolute(configPath))
    throw new V207LiveOrchestratorError("V207_WRANGLER_CONFIG_NOT_ABSOLUTE");
  let metadata;
  try {
    metadata = await lstat(configPath);
  } catch {
    throw new V207LiveOrchestratorError("V207_WRANGLER_CONFIG_UNREADABLE");
  }
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new V207LiveOrchestratorError("V207_WRANGLER_CONFIG_NOT_PROTECTED");
  }
  let config: unknown;
  try {
    config = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  } catch {
    throw new V207LiveOrchestratorError("V207_WRANGLER_CONFIG_INVALID");
  }
  const record = asRecord(config);
  if (
    !record ||
    record.name !== V207_ORCHESTRATOR_WORKER_NAME ||
    typeof record.main !== "string" ||
    !record.main.includes("dist-staging")
  ) {
    throw new V207LiveOrchestratorError("V207_WRANGLER_CONFIG_IDENTITY_INVALID");
  }
  const vars = asRecord(record.vars);
  if (vars?.[V207_ORCHESTRATOR_SECRET_NAME] !== undefined) {
    throw new V207LiveOrchestratorError("V207_SIGNER_NOT_DISABLED_IN_CONFIG");
  }
  return record;
}

function validateRouteUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new V207LiveOrchestratorError("V207_ROUTE_URL_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/v2/v207/generated-output-port"
  ) {
    throw new V207LiveOrchestratorError("V207_ROUTE_URL_INVALID");
  }
  return url.toString();
}

const SAFE_ROUTE_CODE = /^[A-Z][A-Z0-9_.:-]{2,160}$/u;

async function readRouteFingerprint(
  fetchImpl: typeof fetch,
  routeUrl: string,
  signal?: AbortSignal,
): Promise<RouteFingerprint> {
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
    throw new V207LiveOrchestratorError("V207_ROUTE_PROBE_FAILED");
  }
  let value: unknown;
  try {
    value = (await response.json()) as unknown;
  } catch {
    throw new V207LiveOrchestratorError("V207_ROUTE_PROBE_INVALID");
  }
  const error = asRecord(asRecord(value)?.error);
  if (
    !Number.isInteger(response.status) ||
    response.status < 400 ||
    response.status > 599 ||
    typeof error?.code !== "string" ||
    !SAFE_ROUTE_CODE.test(error.code)
  ) {
    throw new V207LiveOrchestratorError("V207_ROUTE_PROBE_INVALID");
  }
  return { status: response.status, code: error.code };
}

async function verifyRouteFingerprint(
  fetchImpl: typeof fetch,
  routeUrl: string,
  expected: RouteFingerprint,
  signal?: AbortSignal,
): Promise<RouteFingerprint> {
  const observed = await readRouteFingerprint(fetchImpl, routeUrl, signal);
  if (observed.status !== expected.status || observed.code !== expected.code) {
    throw new V207LiveOrchestratorError("V207_ROUTE_RESTORATION_UNCONFIRMED");
  }
  return observed;
}

async function waitForSignerRouteActivation(
  fetchImpl: typeof fetch,
  routeUrl: string,
  sleepImpl: (milliseconds: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<{ readonly attempts: number; readonly status: 403 }> {
  const deadline = AbortSignal.timeout(ACTIVATION_PROPAGATION_WINDOW_MS);
  const pollSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
  for (let attempt = 1; attempt <= ACTIVATION_PROPAGATION_MAX_ATTEMPTS; attempt += 1) {
    let observed: RouteFingerprint;
    try {
      observed = await readRouteFingerprint(fetchImpl, routeUrl, pollSignal);
    } catch {
      // Only the exact transient disabled response is retryable. A network,
      // malformed, or unexpected response fails closed without persisting it.
      throw new V207LiveOrchestratorError("V207_AUTHORITY_PROPAGATION_UNCONFIRMED");
    }
    if (observed.status === 403 && observed.code === "V207_AUTHORITY_REJECTED") {
      return { attempts: attempt, status: 403 };
    }
    if (observed.status !== 404 || observed.code !== "V207_ROUTE_DISABLED") {
      throw new V207LiveOrchestratorError("V207_AUTHORITY_PROPAGATION_UNCONFIRMED");
    }
    if (attempt < ACTIVATION_PROPAGATION_MAX_ATTEMPTS) {
      await sleepImpl(ACTIVATION_PROPAGATION_DELAY_MS);
    }
  }
  throw new V207LiveOrchestratorError("V207_AUTHORITY_PROPAGATION_UNCONFIRMED");
}

function evidencePath(options: V207LiveOrchestratorOptions, environment: Environment): string {
  const value =
    options.evidencePath ??
    environment.V207_ORCHESTRATION_EVIDENCE_PATH ??
    `/tmp/videoforge-v207-live-orchestrator-${process.pid}.json`;
  const resolved = resolve(value);
  if (!resolved.startsWith("/tmp/"))
    throw new V207LiveOrchestratorError("V207_EVIDENCE_PATH_INVALID");
  return resolved;
}

async function writeEvidence(path: string, document: EvidenceDocument): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function redactedEnvironment(environment: Environment): Record<string, string | undefined> {
  return redactEnvironment(environment);
}

async function statusVersion(
  run: V207CommandRunner,
  cwd: string,
  configPath: string,
  environment: Environment,
  signal?: AbortSignal,
): Promise<string> {
  const result = requireSuccessful(
    "V207_WRANGLER_STATUS",
    await run({
      command: "pnpm",
      args: [
        "--filter",
        "@videoforge/web",
        "exec",
        "wrangler",
        "deployments",
        "status",
        "--json",
        "--config",
        configPath,
      ],
      cwd,
      env: redactedEnvironment(environment),
      signal,
    }),
  );
  return extractV207WorkerVersionId(parseJsonOutput(result.stdout));
}

async function secretNames(
  run: V207CommandRunner,
  cwd: string,
  configPath: string,
  environment: Environment,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  const result = requireSuccessful(
    "V207_WRANGLER_SECRET_LIST",
    await run({
      command: "pnpm",
      args: [
        "--filter",
        "@videoforge/web",
        "exec",
        "wrangler",
        "secret",
        "list",
        "--format",
        "json",
        "--config",
        configPath,
      ],
      cwd,
      env: redactedEnvironment(environment),
      signal,
    }),
  );
  return parseSecretNames(parseJsonOutput(result.stdout));
}

async function deleteNonceSecret(
  run: V207CommandRunner,
  cwd: string,
  configPath: string,
  environment: Environment,
  signal?: AbortSignal,
): Promise<void> {
  requireSuccessful(
    "V207_WRANGLER_SECRET_DELETE",
    await run({
      command: "pnpm",
      args: [
        "--filter",
        "@videoforge/web",
        "exec",
        "wrangler",
        "secret",
        "delete",
        V207_ORCHESTRATOR_SECRET_NAME,
        "--config",
        configPath,
      ],
      cwd,
      env: redactedEnvironment(environment),
      stdin: "y\n",
      signal,
    }),
  );
}

async function putNonceSecret(
  run: V207CommandRunner,
  cwd: string,
  configPath: string,
  environment: Environment,
  nonce: string,
  signal?: AbortSignal,
): Promise<void> {
  // The nonce is passed only through stdin. It is never an argv item, log field, or evidence value.
  requireSuccessful(
    "V207_WRANGLER_SECRET_PUT",
    await run({
      command: "pnpm",
      args: [
        "--filter",
        "@videoforge/web",
        "exec",
        "wrangler",
        "secret",
        "put",
        V207_ORCHESTRATOR_SECRET_NAME,
        "--config",
        configPath,
      ],
      cwd,
      env: redactedEnvironment(environment),
      stdin: `${nonce}\n`,
      signal,
    }),
  );
}

async function rollbackAndVerify(
  run: V207CommandRunner,
  cwd: string,
  configPath: string,
  environment: Environment,
  expectedVersionId: string,
  signal?: AbortSignal,
): Promise<void> {
  requireSuccessful(
    "V207_WRANGLER_ROLLBACK",
    await run({
      command: "pnpm",
      args: [
        "--filter",
        "@videoforge/web",
        "exec",
        "wrangler",
        "rollback",
        expectedVersionId,
        "--yes",
        "--message",
        "V2-07 bounded orchestrator cleanup",
        "--config",
        configPath,
      ],
      cwd,
      env: redactedEnvironment(environment),
      signal,
    }),
  );
  const observed = await statusVersion(run, cwd, configPath, environment, signal);
  if (observed !== expectedVersionId) {
    throw new V207LiveOrchestratorError("V207_ROLLBACK_VERSION_UNCONFIRMED");
  }
}

function commandEnvironment(
  environment: Environment,
  nonce: string,
  configPath: string,
  preflightOnly = false,
): Record<string, string | undefined> {
  const child = { ...environment };
  child.V207_AUTHORITY_NONCE = nonce;
  child.V207_WRANGLER_CONFIG = configPath;
  child.V207_IMAGE = environment.V207_IMAGE;
  child.V207_IMAGE_SOURCE_COMMIT = environment.V207_IMAGE_SOURCE_COMMIT;
  child.V207_FINITE_CAP_USD = environment.V207_FINITE_CAP_USD;
  if (preflightOnly) child.V207_PREFLIGHT_ONLY = "1";
  else delete child.V207_PREFLIGHT_ONLY;
  delete child[V207_ORCHESTRATOR_SECRET_NAME];
  return child;
}

export async function runV207LiveOrchestration(
  options: V207LiveOrchestratorOptions = {},
): Promise<V207LiveOrchestratorResult> {
  const environment = options.environment ?? process.env;
  const authority = parseV207ActivationAuthority(environment);
  const sourceCommit = environment.V207_IMAGE_SOURCE_COMMIT ?? "";
  if (!SOURCE_COMMIT.test(sourceCommit)) {
    throw new V207LiveOrchestratorError("V207_IMAGE_SOURCE_COMMIT_MISSING");
  }
  const cwd = resolve(options.cwd ?? REPOSITORY_ROOT);
  const configPath = resolve(
    options.configPath ??
      environment.V207_WRANGLER_CONFIG ??
      V207_ORCHESTRATOR_DEFAULT_WRANGLER_CONFIG,
  );
  const routeUrl = validateRouteUrl(
    options.routeUrl ?? environment.V207_ROUTE_URL ?? V207_ORCHESTRATOR_ROUTE,
  );
  const qualificationCommand = resolve(cwd, "apps/web/node_modules/.bin/tsx");
  const evidenceFile = evidencePath(options, environment);
  const run = options.commandRunner ?? spawnV207Command;
  const fetchImpl = options.fetchImpl ?? fetch;
  const nonceFactory = options.nonceFactory ?? (() => randomBytes(32).toString("hex"));
  const sleepImpl =
    options.sleepImpl ??
    ((milliseconds: number): Promise<void> =>
      new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const events: EvidenceEvent[] = [];
  const evidence: EvidenceDocument = {
    schema_version: "videoforge-v207-live-orchestrator/v1",
    worker_name: V207_ORCHESTRATOR_WORKER_NAME,
    route: routeUrl,
    config_path: configPath,
    authority: {
      image_digest: imageDigest(authority.image),
      source_commit: sourceCommit,
      cap_usd: authority.capUsd,
    },
    events,
    result: "RUNNING",
  };
  const record = async (
    event: string,
    detail?: Readonly<Record<string, string | number | boolean | null>>,
  ): Promise<void> => {
    events.push({ event, at: isoNow(), ...(detail === undefined ? {} : { detail }) });
    await writeEvidence(evidenceFile, evidence);
  };

  const filesystem = await statfs(cwd);
  const availableBytes = Math.floor(Number(filesystem.bavail) * Number(filesystem.bsize));
  assertV207DiskHeadroom(availableBytes);
  await record("orchestration_started", { local_disk_available_bytes: availableBytes });
  const abortController = new AbortController();
  let abortRequested = false;
  const signalHandlers: Array<[NodeJS.Signals, () => void]> = [];
  if (options.installSignalHandlers !== false) {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const handler = (): void => {
        abortRequested = true;
        abortController.abort();
      };
      signalHandlers.push([signal, handler]);
      process.once(signal, handler);
    }
  }

  let capturedVersionId: string | undefined;
  let nonce: string | undefined;
  let nonceSecretMayExist = false;
  // Set immediately before deploy: if Wrangler fails part-way through, a Worker mutation may
  // have happened and the captured version must be restored. Earlier failures did not mutate the
  // Worker, so they must not be reported as an unresolvable rollback-target failure.
  let workerMutationMayExist = false;
  let workerRollbackVerified = false;
  let preMutationRoute: RouteFingerprint | undefined;
  let runnerExitCode: number | undefined;
  let primaryError: unknown;
  const cleanupErrors: string[] = [];
  try {
    const clean = requireSuccessful(
      "V207_GIT_STATUS",
      await run({
        command: "git",
        args: ["status", "--porcelain=v1", "--untracked-files=all"],
        cwd,
        env: redactEnvironment(environment),
        signal: abortController.signal,
      }),
    );
    if (clean.stdout.trim() !== "") throw new V207LiveOrchestratorError("V207_GIT_WORKTREE_DIRTY");
    await readProtectedConfig(configPath);
    capturedVersionId = await statusVersion(
      run,
      cwd,
      configPath,
      environment,
      abortController.signal,
    );
    await record("captured_worker_version", { version_id_hash: sha256(capturedVersionId) });
    // Capture the exact pre-mutation route semantics. The restored V2-06 Worker may legitimately
    // answer 503 (HOSTED_ROUTE_NOT_COMPOSED), so cleanup must compare against this fingerprint
    // instead of assuming the V2-07 route is always a 404 before/after the run.
    preMutationRoute = await readRouteFingerprint(fetchImpl, routeUrl, abortController.signal);
    await record("captured_pre_mutation_route", {
      status: preMutationRoute.status,
      code: preMutationRoute.code,
    });

    const beforeSecrets = await secretNames(
      run,
      cwd,
      configPath,
      environment,
      abortController.signal,
    );
    if (beforeSecrets.includes(V207_ORCHESTRATOR_SECRET_NAME)) {
      nonceSecretMayExist = true;
      // Removing a stale signer secret is a remote Worker mutation too. Keep the captured version
      // eligible for rollback even when deletion succeeds and a later build/deploy step fails.
      workerMutationMayExist = true;
      await deleteNonceSecret(run, cwd, configPath, environment, abortController.signal);
      const afterDelete = await secretNames(
        run,
        cwd,
        configPath,
        environment,
        abortController.signal,
      );
      if (afterDelete.includes(V207_ORCHESTRATOR_SECRET_NAME)) {
        throw new V207LiveOrchestratorError("V207_STALE_SIGNER_SECRET_NOT_REMOVED");
      }
      nonceSecretMayExist = false;
      await record("removed_preexisting_signer_secret");
    }

    const build = requireSuccessful(
      "V207_STAGING_BUILD",
      await run({
        command: "pnpm",
        args: ["--filter", "@videoforge/web", "build:staging"],
        cwd,
        env: redactEnvironment(environment),
        signal: abortController.signal,
      }),
    );
    void build;
    const cleanAfterBuild = requireSuccessful(
      "V207_GIT_STATUS_AFTER_BUILD",
      await run({
        command: "git",
        args: ["status", "--porcelain=v1", "--untracked-files=all"],
        cwd,
        env: redactEnvironment(environment),
        signal: abortController.signal,
      }),
    );
    if (cleanAfterBuild.stdout.trim() !== "") {
      throw new V207LiveOrchestratorError("V207_BUILD_DIRTY_WORKTREE");
    }
    await record("staging_built_signer_disabled");

    workerMutationMayExist = true;
    requireSuccessful(
      "V207_SIGNER_DISABLED_DEPLOY",
      await run({
        command: "pnpm",
        args: ["--filter", "@videoforge/web", "exec", "wrangler", "deploy", "--config", configPath],
        cwd,
        env: redactEnvironment(environment),
        signal: abortController.signal,
      }),
    );
    await record("current_source_deployed_signer_disabled");

    nonce = nonceFactory();
    if (!NONCE.test(nonce)) throw new V207LiveOrchestratorError("V207_NONCE_INVALID");
    nonceSecretMayExist = true;
    await putNonceSecret(run, cwd, configPath, environment, nonce, abortController.signal);
    const afterPut = await secretNames(run, cwd, configPath, environment, abortController.signal);
    if (!afterPut.includes(V207_ORCHESTRATOR_SECRET_NAME)) {
      throw new V207LiveOrchestratorError("V207_SIGNER_SECRET_PRESENCE_UNCONFIRMED");
    }
    await record("signer_secret_activated");
    const activation = await waitForSignerRouteActivation(
      fetchImpl,
      routeUrl,
      sleepImpl,
      abortController.signal,
    );
    await record("signer_route_activation_confirmed", {
      attempts: activation.attempts,
      status: activation.status,
    });
    await record("active_route_rejected_missing_header", {
      attempts: activation.attempts,
      status: activation.status,
    });

    if (abortRequested) throw new V207LiveOrchestratorError("V207_OPERATOR_ABORT");
    const preflight = requireSuccessful(
      "V207_LIVE_PREFLIGHT",
      await run({
        command: qualificationCommand,
        args: ["src/server/providers/v207-live-qualification.ts"],
        cwd: resolve(cwd, "apps/web"),
        env: commandEnvironment(environment, nonce, configPath, true),
        signal: abortController.signal,
      }),
    );
    await record("live_preflight_completed", { exit_code: preflight.exitCode ?? -1 });

    const runner = requireSuccessful(
      "V207_LIVE_RUNNER",
      await run({
        command: qualificationCommand,
        args: ["src/server/providers/v207-live-qualification.ts"],
        cwd: resolve(cwd, "apps/web"),
        env: commandEnvironment(environment, nonce, configPath),
        signal: abortController.signal,
      }),
    );
    runnerExitCode = runner.exitCode ?? -1;
    await record("live_runner_finished", { exit_code: runnerExitCode });
    if (runnerExitCode !== 0) throw new V207LiveOrchestratorError("V207_LIVE_RUNNER_NONZERO");
  } catch (error) {
    primaryError = error;
    // Evidence persistence must never prevent the finally-block cleanup from running.
    try {
      await record("orchestration_failed", { code: safeErrorCode(error) });
    } catch {
      // The initialized evidence path remains the only durable diagnostic; cleanup is still
      // attempted and any resulting uncertainty is surfaced as a bounded failure code.
    }
  } finally {
    if (nonceSecretMayExist || nonce !== undefined) {
      try {
        const names = await secretNames(run, cwd, configPath, environment);
        if (names.includes(V207_ORCHESTRATOR_SECRET_NAME)) {
          await deleteNonceSecret(run, cwd, configPath, environment);
        }
        const remaining = await secretNames(run, cwd, configPath, environment);
        if (remaining.includes(V207_ORCHESTRATOR_SECRET_NAME)) {
          cleanupErrors.push("V207_SIGNER_SECRET_CLEANUP_UNCONFIRMED");
        } else {
          nonceSecretMayExist = false;
          await record("signer_secret_deleted");
        }
      } catch (error) {
        cleanupErrors.push(safeErrorCode(error));
      }
    }
    if (workerMutationMayExist && capturedVersionId !== undefined) {
      try {
        await rollbackAndVerify(run, cwd, configPath, environment, capturedVersionId);
        workerRollbackVerified = true;
        await record("worker_rolled_back", { version_id_hash: sha256(capturedVersionId) });
      } catch (error) {
        cleanupErrors.push(safeErrorCode(error));
      }
    } else if (workerMutationMayExist) {
      cleanupErrors.push("V207_ROLLBACK_TARGET_MISSING");
    } else {
      try {
        await record("worker_rollback_skipped_no_mutation");
      } catch {
        cleanupErrors.push("V207_EVIDENCE_PERSIST_FAILED");
      }
    }
    if (workerMutationMayExist) {
      if (!workerRollbackVerified) {
        cleanupErrors.push("V207_ROUTE_RESTORATION_SKIPPED_ROLLBACK_UNCONFIRMED");
      } else {
        try {
          if (preMutationRoute === undefined) {
            cleanupErrors.push("V207_ROUTE_RESTORATION_FINGERPRINT_MISSING");
          } else {
            const restoredRoute = await verifyRouteFingerprint(
              fetchImpl,
              routeUrl,
              preMutationRoute,
              abortController.signal,
            );
            await record("restored_route_confirmed", {
              status: restoredRoute.status,
              code: restoredRoute.code,
            });
          }
        } catch (error) {
          cleanupErrors.push(safeErrorCode(error));
        }
      }
    } else {
      try {
        await record("disabled_route_probe_skipped_no_mutation");
      } catch {
        cleanupErrors.push("V207_EVIDENCE_PERSIST_FAILED");
      }
    }
    if (cleanupErrors.length > 0) {
      evidence.result = "CLEANUP_UNCERTAIN";
      try {
        await record("cleanup_uncertain", {
          error_count: cleanupErrors.length,
          // Every entry is produced by safeErrorCode or a fixed bounded code; never persist child
          // stderr/stdout, provider response bodies, credentials, or signed material.
          cleanup_error_codes: cleanupErrors.join(","),
        });
      } catch {
        // Evidence persistence failure is itself covered by the nonzero cleanup result.
      }
    } else if (primaryError !== undefined) {
      evidence.result = "FAILED";
      try {
        await writeEvidence(evidenceFile, evidence);
      } catch {
        // Preserve the primary failure; the evidence path was already initialized before mutation.
      }
    } else {
      evidence.result = "SUCCEEDED";
      try {
        await record("orchestration_complete", { cleaned_up: true });
      } catch {
        cleanupErrors.push("V207_EVIDENCE_PERSIST_FAILED");
        evidence.result = "CLEANUP_UNCERTAIN";
      }
    }
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  }

  if (cleanupErrors.length > 0) throw new V207LiveOrchestratorError("V207_CLEANUP_UNCERTAIN");
  if (primaryError !== undefined) throw primaryError;
  if (abortRequested) throw new V207LiveOrchestratorError("V207_OPERATOR_ABORT");
  if (capturedVersionId === undefined || runnerExitCode === undefined) {
    throw new V207LiveOrchestratorError("V207_ORCHESTRATION_INCOMPLETE");
  }
  // The evidence excludes the nonce, RunPod key, signed URLs, and child output by construction.
  return {
    evidencePath: evidenceFile,
    capturedVersionIdHash: sha256(capturedVersionId),
    runnerExitCode,
    cleanedUp: true,
  };
}

async function main(): Promise<void> {
  try {
    await runV207LiveOrchestration();
  } catch (error) {
    // Only bounded error codes are printed; child stdout/stderr and all credentials stay private.
    console.error(safeErrorCode(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1]?.endsWith("/v207-live-orchestrator.ts") ||
  process.argv[1]?.endsWith("/v207-live-orchestrator.js")
) {
  void main();
}

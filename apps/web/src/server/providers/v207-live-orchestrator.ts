import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, lstat, mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  parseV207ActivationAuthority,
  type V207ActivationAuthority,
  V207_APPROVED_EXECUTION_ENTRYPOINT,
} from "./v207-activation-authority";
import {
  applyV207RollbackAnchorRefreshMarker,
  revertV207RollbackAnchorRefreshMarker,
  V207_ANCHOR_REFRESH_BASELINE_SHA256,
  V207_ANCHOR_REFRESH_DEFAULT_CONFIG_PATH,
  V207_ANCHOR_REFRESH_ENABLED_SHA256,
  V207_ANCHOR_REFRESH_FILE_MODE,
} from "./v207-anchor-refresh-marker";

export const V207_ORCHESTRATOR_WORKER_NAME = "videoforge-v2-06-staging" as const;
export const V207_ORCHESTRATOR_SECRET_NAME = "VIDEOFORGE_V207_AUTHORITY_NONCE" as const;
export const V207_ORCHESTRATOR_ROUTE =
  "https://videoforge-v2-06-staging.lakshmansai121.workers.dev/api/v2/v207/generated-output-port" as const;
export const V207_ORCHESTRATOR_DEFAULT_WRANGLER_CONFIG = V207_ANCHOR_REFRESH_DEFAULT_CONFIG_PATH;
export const V207_READ_ONLY_ADMISSION_ENTRYPOINT =
  "src/server/providers/v207-read-only-admission.ts" as const;

const REPOSITORY_ROOT = process.cwd().endsWith("/apps/web")
  ? resolve(process.cwd(), "../..")
  : resolve(process.cwd());
const MAX_CAPTURE_BYTES = 128 * 1024;
const ACTIVATION_PROPAGATION_MAX_ATTEMPTS = 30;
const ACTIVATION_PROPAGATION_DELAY_MS = 2_000;
const ACTIVATION_PROPAGATION_WINDOW_MS = 60_000;
const RESTORATION_PROPAGATION_MAX_ATTEMPTS = 60;
const RESTORATION_PROPAGATION_DELAY_MS = 2_000;
const RESTORATION_PROPAGATION_WINDOW_MS = 120_000;
// The first exact probe plus 15 two-second intervals establishes a 30-second
// exact-fingerprint stability window, while the surrounding deadline remains 120 seconds.
const RESTORATION_REQUIRED_CONSECUTIVE_MATCHES = 16;
// A signer-enabled route must remain on the exact authority-rejecting contract for the same
// bounded 30-second window used by route restoration.  A single 403 can come from one edge while
// another edge still serves the previous Worker version; proceeding on that isolated match can
// make a later idempotent FINALIZE replay hit an older request contract.
const ACTIVATION_REQUIRED_CONSECUTIVE_MATCHES = RESTORATION_REQUIRED_CONSECUTIVE_MATCHES;
/**
 * A rollback-anchor refresh is deliberately opt-in and versioned.  The normal
 * V2-07 path must continue to refuse all Worker mutation when its pre-existing
 * anchor is not retained.  A future proposal may opt into the two-phase path
 * only by putting this exact marker in both the activation environment and the
 * protected Wrangler config.
 */
export const V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY = "V207_ROLLBACK_ANCHOR_REFRESH" as const;
export const V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION = "two-phase-v1" as const;

/**
 * The CLI activation and compiled authority form one typed invocation. Keeping
 * this as a discriminated union prevents an approved refresh authority from
 * being represented as the ordinary (refresh-disabled) path merely because a
 * launcher omitted the environment marker.
 */
export type V207RollbackAnchorRefreshInvocation =
  | Readonly<{ enabled: false; activation: null }>
  | Readonly<{
      enabled: true;
      activation: typeof V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION;
    }>;
export const V207_ANCHOR_REFRESH_EXPECTED_OLD_ACTIVE_VERSION_ID_SHA256 =
  "sha256:1e5d35b4c2709641024655c7df5832f360aeb665068804f07ecc600a68186e19" as const;
export const V207_ANCHOR_REFRESH_EXPECTED_OLD_ACTIVE_RECORD_SHA256 =
  "sha256:54cd4dcb8a5b2afe8ca8cad9f7aad7dd6d47ef14b36ef0f7b03c7ba90a234c89" as const;
/** Wrangler's versions list is limited to ten recent versions. Keep three
 * slots of headroom for the bounded deploy/secret mutations and propagation
 * churn, so the captured rollback target must be in the newest seven. */
export const V207_WORKER_VERSION_LIST_LIMIT = 10;
export const V207_WORKER_VERSION_NEWEST_COUNT = 7;
const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NONCE = /^[a-f0-9]{64}$/u;
const SOURCE_COMMIT = /^[0-9a-f]{40}$/u;
export const V207_ORCHESTRATOR_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;
/**
 * Qualification's direct-entrypoint catch prints one bounded error code to stderr.  Only these
 * known code families may cross the child-process boundary; everything else (including logs,
 * URLs, provider bodies, identifiers, and credentials) is deliberately discarded.
 */
const V207_CHILD_FAILURE_CODE = /\b(?:MAGE|RUNPOD|SERVERLESS|V207)_[A-Z0-9][A-Z0-9_.-]{1,159}\b/u;
const V207_CHILD_FAILURE_UNCLASSIFIED = "V207_CHILD_FAILURE_UNCLASSIFIED" as const;

/**
 * Wrangler emits human-readable diagnostics on stderr and, depending on the version, sometimes
 * stdout.  The deploy boundary may classify those diagnostics, but it must never persist the
 * diagnostic text itself.  Keep this list intentionally small: a class is useful for deciding
 * whether a later provider-free repair is warranted, while an unrecognised message must remain
 * `unknown` rather than becoming an accidental assertion about the provider.
 */
export const V207_WRANGLER_DEPLOY_FAILURE_CLASSES = [
  "authentication",
  "configuration",
  "network",
  "rate_limit",
  "provider",
  "unknown",
] as const;
export type V207WranglerDeployFailureClass = (typeof V207_WRANGLER_DEPLOY_FAILURE_CLASSES)[number];
export const V207_WRANGLER_DEPLOY_FAILURE_EVENT_DETAIL_KEYS = [
  "deploy_failure_class",
  "deploy_output_channel",
  "deploy_exit_code",
  "deploy_signal",
] as const;
type V207WranglerDeployFailureOutputChannel = "stderr" | "stdout" | "both" | "none";
export interface V207WranglerDeployFailureDiagnostic {
  readonly failure_class: V207WranglerDeployFailureClass;
  readonly output_channel: V207WranglerDeployFailureOutputChannel;
  readonly exit_code: number | null;
  readonly signal: NodeJS.Signals | null;
}

const V207_WRANGLER_DEPLOY_FAILURE_PATTERNS: ReadonlyArray<{
  readonly failureClass: Exclude<V207WranglerDeployFailureClass, "unknown">;
  readonly pattern: RegExp;
}> = [
  {
    failureClass: "authentication",
    pattern:
      /\b(?:authentication|unauthori[sz]ed|forbidden|invalid\s+(?:api\s+)?token|api\s+token\s+(?:is\s+)?invalid|not\s+authorized|access\s+denied)\b/iu,
  },
  {
    failureClass: "configuration",
    pattern:
      /\b(?:invalid\s+config(?:uration)?|config(?:uration)?\s+(?:file|error)|missing\s+(?:account[_ -]?id|script(?:\s+name)?|config)|account[_ -]?id\s+(?:is\s+)?required|compatibility\s+date)\b/iu,
  },
  {
    failureClass: "network",
    pattern:
      /\b(?:network|fetch\s+failed|econn(?:refused|reset)|enotfound|etimedout|timed\s+out|socket|tls|dns)\b/iu,
  },
  {
    failureClass: "rate_limit",
    pattern: /\b(?:rate[- ]?limit(?:ed|ing)?|too\s+many\s+requests|quota|\b429\b)\b/iu,
  },
  {
    failureClass: "provider",
    pattern:
      /\b(?:cloudflare\s+api|api\s+request\s+(?:failed|error)|internal\s+server\s+error|bad\s+gateway|service\s+unavailable|\b5\d{2}\b|error\s+code\s*[:=]?\s*\d{4,6}|code\s*[:=]\s*\d{4,6})\b/iu,
  },
];
const V207_CHILD_SIGNAL_NAMES = new Set<string>([
  "SIGABRT",
  "SIGALRM",
  "SIGBUS",
  "SIGCHLD",
  "SIGCONT",
  "SIGFPE",
  "SIGHUP",
  "SIGILL",
  "SIGINT",
  "SIGIO",
  "SIGIOT",
  "SIGKILL",
  "SIGPIPE",
  "SIGPOLL",
  "SIGPROF",
  "SIGPWR",
  "SIGQUIT",
  "SIGSEGV",
  "SIGSTKFLT",
  "SIGSTOP",
  "SIGSYS",
  "SIGTERM",
  "SIGTRAP",
  "SIGTSTP",
  "SIGTTIN",
  "SIGTTOU",
  "SIGURG",
  "SIGUSR1",
  "SIGUSR2",
  "SIGVTALRM",
  "SIGWINCH",
  "SIGXCPU",
  "SIGXFSZ",
]);

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
  /** Test-only authority injection; production always parses the compiled exact authority. */
  readonly authorityParser?: (environment: Environment) => V207ActivationAuthority;
  readonly cwd?: string;
  readonly configPath?: string;
  readonly routeUrl?: string;
  readonly evidencePath?: string;
  readonly commandRunner?: V207CommandRunner;
  readonly fetchImpl?: typeof fetch;
  readonly nonceFactory?: () => string;
  /** Test-only dependency injection for the bounded secret-propagation poll. */
  readonly sleepImpl?: (milliseconds: number) => Promise<void>;
  /** Test-only hard deadline for route restoration; production uses a fresh 120-second signal. */
  readonly routeRestorationSignal?: AbortSignal;
  /** Test-only expected old-anchor overrides; production is pinned to the exact proposal hashes. */
  readonly expectedOldActiveVersionIdSha256?: string;
  readonly expectedOldActiveRecordSha256?: string;
  /** Test-only filesystem headroom override; production always reads statfs. */
  readonly diskAvailableBytes?: number;
  /** Tests disable process signal registration; production leaves it enabled. */
  readonly installSignalHandlers?: boolean;
}

export interface V207LiveOrchestratorResult {
  readonly evidencePath: string;
  readonly capturedVersionIdHash: string;
  readonly runnerExitCode: number;
  readonly cleanedUp: true;
}

/**
 * The exact active-version record captured before the first remote mutation.
 *
 * Wrangler's deployment envelope `id` is not a rollback target.  The anchor is
 * therefore the active `versions[]` record (or an explicit version record in an
 * alternate status shape), hashed after deterministic JSON normalization.  The
 * hash is re-read after rollback; a matching UUID alone is not enough because a
 * provider can expose a different deployment record under the same route.
 */
export interface V207WorkerRollbackAnchor {
  readonly versionId: string;
  readonly sha256: string;
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
  readonly workerVersionId: string | null;
}

interface V207RollbackAnchorRefresh {
  readonly enabled: boolean;
}

interface EvidenceDocument {
  readonly schema_version: "videoforge-v207-live-orchestrator/v1";
  readonly worker_name: typeof V207_ORCHESTRATOR_WORKER_NAME;
  readonly route: typeof V207_ORCHESTRATOR_ROUTE | string;
  readonly config_path: string;
  readonly authority: {
    readonly image_digest: string;
    readonly source_commit: string;
    readonly proposal_sha256: string;
    readonly cap_usd: number;
    readonly anchor_refresh_authorized: boolean;
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

/**
 * Extract at most one safe code from the qualification child's stderr.  This function must never
 * be called with stdout: the child may emit progress, provider diagnostics, URLs, or credentials
 * there.  The returned value is a new bounded token, never a substring containing surrounding
 * stderr.  A fixed fallback keeps the evidence useful without persisting untrusted text.
 */
export function extractV207ChildFailureCode(stderr: string): string {
  const match = V207_CHILD_FAILURE_CODE.exec(stderr.slice(0, MAX_CAPTURE_BYTES));
  return match?.[0] ?? V207_CHILD_FAILURE_UNCLASSIFIED;
}

const normalizeDeployExitCode = (value: number | null): number | null =>
  value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 255 ? value : null;

const normalizeDeploySignal = (value: NodeJS.Signals | null): NodeJS.Signals | null =>
  typeof value === "string" && V207_CHILD_SIGNAL_NAMES.has(value)
    ? (value as NodeJS.Signals)
    : null;

/**
 * Classify a failed Wrangler deploy without allowing untrusted command output to cross the
 * evidence boundary.  Both output channels are inspected in memory because Wrangler has emitted
 * the same class of failure on either channel across versions.  Only the allowlisted class,
 * channel-presence tuple, exit code, and signal are returned; URLs, response bodies, identifiers,
 * headers, tokens, and arbitrary text are never returned or persisted.
 */
export function classifyV207WranglerDeployFailure(
  result: Pick<V207CommandResult, "exitCode" | "signal" | "stdout" | "stderr">,
): V207WranglerDeployFailureDiagnostic {
  const stderr = typeof result.stderr === "string" ? result.stderr.slice(0, MAX_CAPTURE_BYTES) : "";
  const stdout = typeof result.stdout === "string" ? result.stdout.slice(0, MAX_CAPTURE_BYTES) : "";
  const matchingClass = V207_WRANGLER_DEPLOY_FAILURE_PATTERNS.find(
    ({ pattern }) => pattern.test(stderr) || pattern.test(stdout),
  )?.failureClass;
  const stderrHasOutput = stderr.length > 0;
  const stdoutHasOutput = stdout.length > 0;
  const outputChannel: V207WranglerDeployFailureOutputChannel =
    stderrHasOutput && stdoutHasOutput
      ? "both"
      : stderrHasOutput
        ? "stderr"
        : stdoutHasOutput
          ? "stdout"
          : "none";
  return Object.freeze({
    failure_class: matchingClass ?? "unknown",
    output_channel: outputChannel,
    exit_code: normalizeDeployExitCode(result.exitCode),
    signal: normalizeDeploySignal(result.signal),
  });
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
  try {
    return extractV207WorkerRollbackAnchor(value).versionId;
  } catch (error) {
    if (
      error instanceof V207LiveOrchestratorError &&
      error.code === "V207_WORKER_ROLLBACK_ANCHOR_MISSING"
    ) {
      throw new V207LiveOrchestratorError("V207_WORKER_VERSION_ID_MISSING");
    }
    throw error;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function findV207WorkerRollbackAnchor(
  value: unknown,
): { versionId: string; value: unknown } | null {
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

  const activeVersionFromList = (entries: unknown[]): unknown | null => {
    const records = entries.filter((entry): entry is JsonRecord => asRecord(entry) !== null);
    if (records.length === 0) return null;
    const active = records.filter((record) => {
      if (record.is_active === true || record.active === true) return true;
      const percentage = Number(record.percentage ?? record.traffic_percent);
      return Number.isFinite(percentage) && percentage === 100;
    });
    const candidates = active.length === 1 ? active : records.length === 1 ? records : [];
    if (candidates.length !== 1) return null;
    return candidates.length === 1 ? candidates[0] : null;
  };

  const visit = (candidate: unknown): { versionId: string; value: unknown } | null => {
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

    if (Array.isArray(record.versions)) {
      const active = activeVersionFromList(record.versions);
      const activeVersionId = active === null ? null : versionFromEntry(active);
      if (active !== null && activeVersionId !== null) {
        return { versionId: activeVersionId, value: active };
      }
      // An envelope with an ambiguous/malformed versions list must not fall
      // through to its deployment id. Continue only into non-id metadata.
      for (const [key, entry] of Object.entries(record)) {
        if (key === "id" || key === "versions" || versionKeySet.has(key)) continue;
        const found = visit(entry);
        if (found) return found;
      }
      return null;
    }

    const explicit = readVersionField(record);
    if (explicit) return { versionId: explicit, value: record };

    // Wrangler's status command can also emit a bare `{ id: <version> }` in
    // older/alternate shapes. This fallback is safe only without a deployment
    // versions collection (handled above).
    if (typeof record.id === "string" && VERSION_ID.test(record.id)) {
      return { versionId: record.id, value: record };
    }

    for (const [key, entry] of Object.entries(record)) {
      if (versionKeySet.has(key) || key === "id") continue;
      const found = visit(entry);
      if (found) return found;
    }
    return null;
  };

  const found = visit(value);
  return found;
}

export function extractV207WorkerRollbackAnchor(value: unknown): V207WorkerRollbackAnchor {
  const found = findV207WorkerRollbackAnchor(value);
  if (found === null) throw new V207LiveOrchestratorError("V207_WORKER_ROLLBACK_ANCHOR_MISSING");
  const normalized = canonicalJson(found.value);
  if (normalized === "undefined") {
    throw new V207LiveOrchestratorError("V207_WORKER_ROLLBACK_ANCHOR_INVALID");
  }
  return Object.freeze({
    versionId: found.versionId,
    sha256: sha256(normalized),
  });
}

function collectV207WorkerVersionIds(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectV207WorkerVersionIds(entry, output);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const key of ["version_id", "versionId"] as const) {
    const candidate = record[key];
    if (typeof candidate === "string" && VERSION_ID.test(candidate)) {
      output.push(candidate);
      return;
    }
  }
  const beforeNested = output.length;
  for (const [key, entry] of Object.entries(record)) {
    if (key === "id" || key === "version_id" || key === "versionId") continue;
    collectV207WorkerVersionIds(entry, output);
  }
  if (output.length > beforeNested) return;
  const genericId = record.id;
  if (typeof genericId === "string" && VERSION_ID.test(genericId)) output.push(genericId);
}

/**
 * Prove the captured version is still in Wrangler's recent-version retention
 * window before allowing any Worker or secret mutation. A status response can
 * identify the active version even after it has fallen out of the rollback
 * list; the list read is the bounded provider-side retention proof.
 */
export function assertV207WorkerRollbackAnchorRetained(
  value: unknown,
  expectedVersionId: string,
): number {
  if (!VERSION_ID.test(expectedVersionId)) {
    throw new V207LiveOrchestratorError("V207_WORKER_ROLLBACK_ANCHOR_INVALID");
  }
  const ids: string[] = [];
  collectV207WorkerVersionIds(value, ids);
  const uniqueIds = [...new Set(ids)];
  if (ids.length !== uniqueIds.length) {
    throw new V207LiveOrchestratorError("V207_WORKER_VERSION_LIST_INVALID");
  }
  if (uniqueIds.length === 0 || uniqueIds.length > V207_WORKER_VERSION_LIST_LIMIT) {
    throw new V207LiveOrchestratorError("V207_WORKER_ROLLBACK_ANCHOR_NOT_RETAINED");
  }
  // Wrangler currently returns the bounded list oldest-to-newest. Require the
  // target in the newest seven entries, leaving three slots for the planned
  // deploy/secret churn even if two new versions are appended immediately.
  const index = uniqueIds.indexOf(expectedVersionId);
  const newestStart = Math.max(0, uniqueIds.length - V207_WORKER_VERSION_NEWEST_COUNT);
  if (index < newestStart) {
    throw new V207LiveOrchestratorError("V207_WORKER_ROLLBACK_ANCHOR_NOT_RETAINED");
  }
  return index;
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
  if (!metadata.isFile() || (metadata.mode & 0o7777) !== V207_ANCHOR_REFRESH_FILE_MODE) {
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

/**
 * Bind the exact versioned launcher marker to the compiled authority before
 * any command, provider read, route probe, or mutation can occur. An approved
 * refresh is a required execution mode, not an optional capability that may
 * silently fall back to ordinary orchestration.
 */
export function bindV207RollbackAnchorRefreshInvocation(
  environment: Readonly<Record<string, string | undefined>>,
  authority: Pick<V207ActivationAuthority, "anchorRefreshAuthorized">,
): V207RollbackAnchorRefreshInvocation {
  const value = environment[V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY];
  const present = value !== undefined && value !== "";
  if (present && value !== V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION) {
    throw new V207LiveOrchestratorError("V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION_INVALID");
  }
  if (authority.anchorRefreshAuthorized && !present) {
    throw new V207LiveOrchestratorError("V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION_REQUIRED");
  }
  if (!authority.anchorRefreshAuthorized && present) {
    throw new V207LiveOrchestratorError("V207_ROLLBACK_ANCHOR_REFRESH_AUTHORITY_REQUIRED");
  }
  return authority.anchorRefreshAuthorized
    ? { enabled: true, activation: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION }
    : { enabled: false, activation: null };
}

/**
 * Resolve the optional rollback-anchor refresh mode.  A single environment
 * toggle is not sufficient: the protected Wrangler config must carry the same
 * exact versioned marker.  This keeps a stale shell variable, copied config,
 * or accidental boolean from silently authorizing the extra Worker deploy.
 */
function resolveV207RollbackAnchorRefresh(
  environment: Environment,
  config: JsonRecord,
): V207RollbackAnchorRefresh {
  const envValue = environment[V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY];
  const vars = asRecord(config.vars);
  const configValue = vars?.[V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY];
  const hasEnvValue = envValue !== undefined && envValue !== "";
  const hasConfigValue = configValue !== undefined;

  if (
    (hasEnvValue && envValue !== V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION) ||
    (hasConfigValue && configValue !== V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION)
  ) {
    throw new V207LiveOrchestratorError("V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION_INVALID");
  }
  if (hasEnvValue !== hasConfigValue || (hasEnvValue && !hasConfigValue)) {
    throw new V207LiveOrchestratorError("V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_MISMATCH");
  }
  return { enabled: hasEnvValue && hasConfigValue };
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
export const V207_ROUTE_VERSION_HEADER = "x-videoforge-worker-version" as const;

/**
 * Probe responses are allowed to carry only the exact Cloudflare Worker version UUID.  The
 * active route check compares this value with the post-secret Wrangler status readback; a static
 * contract header is not enough because an old edge can serve the same contract name.
 */
const readRouteVersionIdentity = (response: Response, required: boolean): string | null => {
  const value = response.headers.get(V207_ROUTE_VERSION_HEADER);
  if (value === null) {
    if (required) throw new V207LiveOrchestratorError("V207_ROUTE_VERSION_ID_MISSING");
    return null;
  }
  if (!VERSION_ID.test(value)) {
    throw new V207LiveOrchestratorError("V207_ROUTE_VERSION_ID_INVALID");
  }
  return value;
};

async function readRouteFingerprint(
  fetchImpl: typeof fetch,
  routeUrl: string,
  signal?: AbortSignal,
  requireVersionIdentity = false,
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
  return {
    status: response.status,
    code: error.code,
    workerVersionId: readRouteVersionIdentity(response, requireVersionIdentity),
  };
}

async function waitForRouteRestoration(
  fetchImpl: typeof fetch,
  routeUrl: string,
  expected: RouteFingerprint,
  sleepImpl: (milliseconds: number) => Promise<void>,
  signal: AbortSignal,
  expectedWorkerVersionId?: string,
): Promise<RouteFingerprint> {
  if (expectedWorkerVersionId !== undefined && !VERSION_ID.test(expectedWorkerVersionId)) {
    throw new V207LiveOrchestratorError("V207_ROUTE_VERSION_ID_INVALID");
  }
  let consecutiveMatches = 0;
  for (let attempt = 1; attempt <= RESTORATION_PROPAGATION_MAX_ATTEMPTS; attempt += 1) {
    if (signal.aborted) break;
    let observed: RouteFingerprint | undefined;
    try {
      observed = await readRouteFingerprint(
        fetchImpl,
        routeUrl,
        signal,
        expectedWorkerVersionId !== undefined,
      );
    } catch (error) {
      // In refresh mode, an identity that is missing or malformed is an
      // observed edge mismatch, not a transient reachability failure. Keep
      // the precise bounded identity error so cleanup cannot accept a later
      // isolated status/code match from another Worker version.
      if (
        expectedWorkerVersionId !== undefined &&
        error instanceof V207LiveOrchestratorError &&
        (error.code === "V207_ROUTE_VERSION_ID_MISSING" ||
          error.code === "V207_ROUTE_VERSION_ID_INVALID")
      ) {
        throw error;
      }
      if (consecutiveMatches > 0) {
        // Once the captured fingerprint has appeared, a probe error is an unproven
        // alternation rather than a stable restoration. Fail closed instead of
        // accepting a later isolated match.
        throw new V207LiveOrchestratorError("V207_ROUTE_RESTORATION_UNCONFIRMED");
      }
      // Cleanup tolerates bounded transient reachability failure before the exact
      // fingerprint first appears. The captured fingerprint is still required before
      // cleanup can be called confirmed.
      consecutiveMatches = 0;
    }
    if (observed !== undefined) {
      if (
        expectedWorkerVersionId !== undefined &&
        observed.workerVersionId !== expectedWorkerVersionId
      ) {
        throw new V207LiveOrchestratorError("V207_ROUTE_VERSION_ID_UNCONFIRMED");
      }
      const matches = observed.status === expected.status && observed.code === expected.code;
      if (matches) {
        consecutiveMatches += 1;
        if (consecutiveMatches >= RESTORATION_REQUIRED_CONSECUTIVE_MATCHES) return observed;
      } else if (consecutiveMatches > 0) {
        // A matching probe followed by a different status/code is the exact
        // 404/503 flap seen during Attempt 16. Do not reset and later accept it.
        throw new V207LiveOrchestratorError("V207_ROUTE_RESTORATION_UNCONFIRMED");
      }
    }
    if (signal.aborted) break;
    if (attempt < RESTORATION_PROPAGATION_MAX_ATTEMPTS) {
      await Promise.race([
        sleepImpl(RESTORATION_PROPAGATION_DELAY_MS),
        new Promise<void>((resolveAbort) => {
          if (signal.aborted) resolveAbort();
          else signal.addEventListener("abort", () => resolveAbort(), { once: true });
        }),
      ]);
    }
  }
  throw new V207LiveOrchestratorError("V207_ROUTE_RESTORATION_UNCONFIRMED");
}

const V207_REFRESH_DISABLED_ROUTE: RouteFingerprint = Object.freeze({
  status: 404,
  code: "V207_ROUTE_DISABLED",
  workerVersionId: null,
});

/**
 * After the signer-disabled refresh deploy, require the route's exact disabled
 * fingerprint for the same bounded stability window used by cleanup.  A
 * mismatch is never treated as transient: proceeding would make the newly
 * captured Worker version an unproven rollback target and could send the
 * qualification child through an unexpected Worker.
 */
async function waitForRefreshDisabledRoute(
  fetchImpl: typeof fetch,
  routeUrl: string,
  sleepImpl: (milliseconds: number) => Promise<void>,
  signal: AbortSignal,
  failureCode = "V207_ROLLBACK_ANCHOR_REFRESH_ROUTE_UNCONFIRMED",
  expectedWorkerVersionId?: string,
  tolerateTransportGaps = false,
  onTransportGap?: (count: number) => Promise<void>,
): Promise<RouteFingerprint> {
  if (expectedWorkerVersionId !== undefined && !VERSION_ID.test(expectedWorkerVersionId)) {
    throw new V207LiveOrchestratorError("V207_ROUTE_VERSION_ID_INVALID");
  }
  const deadline = AbortSignal.timeout(RESTORATION_PROPAGATION_WINDOW_MS);
  const pollSignal = AbortSignal.any([signal, deadline]);
  let consecutiveMatches = 0;
  let transportGapCount = 0;
  for (let attempt = 1; attempt <= RESTORATION_PROPAGATION_MAX_ATTEMPTS; attempt += 1) {
    if (pollSignal.aborted) break;
    let observed: RouteFingerprint | undefined;
    try {
      observed = await readRouteFingerprint(
        fetchImpl,
        routeUrl,
        pollSignal,
        expectedWorkerVersionId !== undefined,
      );
    } catch (error) {
      if (
        expectedWorkerVersionId !== undefined &&
        error instanceof V207LiveOrchestratorError &&
        (error.code === "V207_ROUTE_VERSION_ID_MISSING" ||
          error.code === "V207_ROUTE_VERSION_ID_INVALID")
      ) {
        throw error;
      }
      if (
        tolerateTransportGaps &&
        error instanceof V207LiveOrchestratorError &&
        error.code === "V207_ROUTE_PROBE_FAILED"
      ) {
        transportGapCount += 1;
        consecutiveMatches = 0;
        await onTransportGap?.(transportGapCount);
        if (pollSignal.aborted) break;
      } else {
        // Preserve bounded lower-level classification during the repaired
        // pre-mutation window. Other refresh phases retain their established
        // fail-closed umbrella code.
        if (tolerateTransportGaps) throw error;
        throw new V207LiveOrchestratorError(failureCode);
      }
    }
    if (observed === undefined) {
      if (attempt < RESTORATION_PROPAGATION_MAX_ATTEMPTS) {
        await Promise.race([
          sleepImpl(RESTORATION_PROPAGATION_DELAY_MS),
          new Promise<void>((resolveAbort) => {
            if (pollSignal.aborted) resolveAbort();
            else pollSignal.addEventListener("abort", () => resolveAbort(), { once: true });
          }),
        ]);
      }
      continue;
    }
    if (
      expectedWorkerVersionId !== undefined &&
      observed.workerVersionId !== expectedWorkerVersionId
    ) {
      throw new V207LiveOrchestratorError("V207_ROUTE_VERSION_ID_UNCONFIRMED");
    }
    if (
      observed.status !== V207_REFRESH_DISABLED_ROUTE.status ||
      observed.code !== V207_REFRESH_DISABLED_ROUTE.code
    ) {
      throw new V207LiveOrchestratorError(failureCode);
    }
    consecutiveMatches += 1;
    if (consecutiveMatches >= RESTORATION_REQUIRED_CONSECUTIVE_MATCHES) return observed;
    if (attempt < RESTORATION_PROPAGATION_MAX_ATTEMPTS) {
      await Promise.race([
        sleepImpl(RESTORATION_PROPAGATION_DELAY_MS),
        new Promise<void>((resolveAbort) => {
          if (pollSignal.aborted) resolveAbort();
          else pollSignal.addEventListener("abort", () => resolveAbort(), { once: true });
        }),
      ]);
    }
  }
  if (transportGapCount > 0) {
    throw new V207LiveOrchestratorError(
      "V207_ROLLBACK_ANCHOR_REFRESH_PRE_ROUTE_TRANSPORT_EXHAUSTED",
    );
  }
  throw new V207LiveOrchestratorError(failureCode);
}

async function waitForSignerRouteActivation(
  fetchImpl: typeof fetch,
  routeUrl: string,
  sleepImpl: (milliseconds: number) => Promise<void>,
  signal?: AbortSignal,
  expectedWorkerVersionId?: string,
  onTransportGap?: (count: number) => Promise<void>,
): Promise<{ readonly attempts: number; readonly status: 403 }> {
  const deadline = AbortSignal.timeout(ACTIVATION_PROPAGATION_WINDOW_MS);
  const pollSignal = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
  let consecutiveMatches = 0;
  let transportGapCount = 0;
  for (let attempt = 1; attempt <= ACTIVATION_PROPAGATION_MAX_ATTEMPTS; attempt += 1) {
    let observed: RouteFingerprint | undefined;
    try {
      observed = await readRouteFingerprint(fetchImpl, routeUrl, pollSignal, true);
    } catch (error) {
      if (
        error instanceof V207LiveOrchestratorError &&
        (error.code === "V207_ROUTE_VERSION_ID_MISSING" ||
          error.code === "V207_ROUTE_VERSION_ID_INVALID")
      ) {
        throw error;
      }
      // A route transport gap can occur while the newly activated secret is still propagating,
      // but it is retryable only before the first valid exact signer response. Once an exact 403
      // has appeared, a gap proves an unbounded edge split and must fail closed immediately.
      if (
        consecutiveMatches === 0 &&
        !pollSignal.aborted &&
        error instanceof V207LiveOrchestratorError &&
        error.code === "V207_ROUTE_PROBE_FAILED"
      ) {
        transportGapCount += 1;
        await onTransportGap?.(transportGapCount);
      } else {
        // Malformed, unexpected, or version-invalid responses are never transient. Do not persist
        // their body/status; only the bounded orchestrator code crosses the evidence boundary.
        throw new V207LiveOrchestratorError("V207_AUTHORITY_PROPAGATION_UNCONFIRMED");
      }
    }
    if (observed === undefined) {
      if (attempt < ACTIVATION_PROPAGATION_MAX_ATTEMPTS) {
        await Promise.race([
          sleepImpl(ACTIVATION_PROPAGATION_DELAY_MS),
          new Promise<void>((resolveAbort) => {
            if (pollSignal.aborted) resolveAbort();
            else pollSignal.addEventListener("abort", () => resolveAbort(), { once: true });
          }),
        ]);
      }
      continue;
    }
    if (
      expectedWorkerVersionId !== undefined &&
      observed.workerVersionId !== expectedWorkerVersionId
    ) {
      throw new V207LiveOrchestratorError("V207_AUTHORITY_VERSION_ID_UNCONFIRMED");
    }
    if (observed.status === 403 && observed.code === "V207_AUTHORITY_REJECTED") {
      if (
        observed.workerVersionId === null ||
        (expectedWorkerVersionId !== undefined &&
          observed.workerVersionId !== expectedWorkerVersionId)
      ) {
        throw new V207LiveOrchestratorError("V207_AUTHORITY_VERSION_ID_UNCONFIRMED");
      }
      consecutiveMatches += 1;
      if (consecutiveMatches >= ACTIVATION_REQUIRED_CONSECUTIVE_MATCHES) {
        return { attempts: attempt, status: 403 };
      }
    } else {
      if (consecutiveMatches > 0) {
        // Once the active route has appeared, any later disabled/old-contract response proves edge
        // alternation rather than transient propagation.  Never reset and accept a later isolated
        // 403 because the qualification child would observe a mixed Worker contract.
        throw new V207LiveOrchestratorError("V207_AUTHORITY_PROPAGATION_UNCONFIRMED");
      }
      if (observed.status !== 404 || observed.code !== "V207_ROUTE_DISABLED") {
        throw new V207LiveOrchestratorError("V207_AUTHORITY_PROPAGATION_UNCONFIRMED");
      }
    }
    if (attempt < ACTIVATION_PROPAGATION_MAX_ATTEMPTS) {
      await sleepImpl(ACTIVATION_PROPAGATION_DELAY_MS);
    }
  }
  // Keep the public failure contract stable while making the bounded gap policy explicit in
  // control flow: exhausting the existing attempt/window never admits the qualification child.
  void transportGapCount;
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
): Promise<V207WorkerRollbackAnchor> {
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
  return extractV207WorkerRollbackAnchor(parseJsonOutput(result.stdout));
}

async function recentWorkerVersions(
  run: V207CommandRunner,
  cwd: string,
  configPath: string,
  environment: Environment,
  signal?: AbortSignal,
): Promise<unknown> {
  const result = requireSuccessful(
    "V207_WRANGLER_VERSIONS_LIST",
    await run({
      command: "pnpm",
      args: [
        "--filter",
        "@videoforge/web",
        "exec",
        "wrangler",
        "versions",
        "list",
        "--json",
        "--config",
        configPath,
      ],
      cwd,
      env: redactedEnvironment(environment),
      signal,
    }),
  );
  return parseJsonOutput(result.stdout);
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
  expectedAnchor: V207WorkerRollbackAnchor,
  signal?: AbortSignal,
  requireRetentionAfterRollback = false,
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
        expectedAnchor.versionId,
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
  if (
    observed.versionId !== expectedAnchor.versionId ||
    observed.sha256 !== expectedAnchor.sha256
  ) {
    throw new V207LiveOrchestratorError("V207_ROLLBACK_VERSION_UNCONFIRMED");
  }
  if (requireRetentionAfterRollback) {
    const recentVersions = await recentWorkerVersions(run, cwd, configPath, environment, signal);
    assertV207WorkerRollbackAnchorRetained(recentVersions, expectedAnchor.versionId);
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
  child.V207_PROPOSAL_SHA256 = environment.V207_PROPOSAL_SHA256;
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
  if (environment.V207_EXECUTION_ENTRYPOINT === V207_APPROVED_EXECUTION_ENTRYPOINT) {
    throw new V207LiveOrchestratorError("V207_LEGACY_ENTRYPOINT_FORBIDDEN");
  }
  const authority = (options.authorityParser ?? parseV207ActivationAuthority)(environment);
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
  // Production execution is pinned to the one reviewed protected config. Tests opt out of
  // process signal installation and may use an exact temporary copy to exercise atomic writes.
  if (
    options.installSignalHandlers !== false &&
    configPath !== resolve(V207_ORCHESTRATOR_DEFAULT_WRANGLER_CONFIG)
  ) {
    throw new V207LiveOrchestratorError("V207_WRANGLER_CONFIG_PATH_MISMATCH");
  }
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
      proposal_sha256: authority.proposalSha256,
      cap_usd: authority.capUsd,
      anchor_refresh_authorized: authority.anchorRefreshAuthorized,
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

  let availableBytes = options.diskAvailableBytes;
  if (availableBytes === undefined) {
    const filesystem = await statfs(cwd);
    availableBytes = Math.floor(Number(filesystem.bavail) * Number(filesystem.bsize));
  }
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

  let capturedAnchor: V207WorkerRollbackAnchor | undefined;
  let initialRollbackAnchor: V207WorkerRollbackAnchor | undefined;
  let signerActiveAnchor: V207WorkerRollbackAnchor | undefined;
  let nonce: string | undefined;
  let nonceSecretMayExist = false;
  // Set immediately before deploy: if Wrangler fails part-way through, a Worker mutation may
  // have happened and the captured version must be restored. Earlier failures did not mutate the
  // Worker, so they must not be reported as an unresolvable rollback-target failure.
  let workerMutationMayExist = false;
  let workerRollbackVerified = false;
  let anchorRefreshInvocation: V207RollbackAnchorRefreshInvocation = {
    enabled: false,
    activation: null,
  };
  let rollbackAnchorRefresh: V207RollbackAnchorRefresh = { enabled: false };
  let anchorRefreshMarkerApplyAttempted = false;
  let anchorRefreshMarkerApplied = false;
  let refreshValidationStarted = false;
  let refreshCompleted = false;
  let preMutationRoute: RouteFingerprint | undefined;
  let runnerExitCode: number | undefined;
  let childFailureCode: string | undefined;
  let deployFailureDiagnostic: V207WranglerDeployFailureDiagnostic | undefined;
  let primaryError: unknown;
  const cleanupErrors: string[] = [];
  try {
    try {
      anchorRefreshInvocation = bindV207RollbackAnchorRefreshInvocation(environment, authority);
      await record("rollback_anchor_refresh_invocation_checked", {
        activation: anchorRefreshInvocation.activation ?? "disabled",
        authority_bound: authority.anchorRefreshAuthorized,
        environment_bound: anchorRefreshInvocation.enabled,
      });
    } catch (error) {
      await record("rollback_anchor_refresh_invocation_rejected", {
        code: safeErrorCode(error),
        authority_bound: authority.anchorRefreshAuthorized,
        environment_bound:
          environment[V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY] ===
          V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
      });
      throw error;
    }
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

    let protectedConfig = await readProtectedConfig(configPath);
    const configuredRefreshMarker = asRecord(protectedConfig.vars)?.[
      V207_ROLLBACK_ANCHOR_REFRESH_CONFIG_KEY
    ];
    if (anchorRefreshInvocation.enabled && configuredRefreshMarker === undefined) {
      // The protected config is the only local input that enables the extra deploy. Apply the
      // exact marker atomically immediately before the first remote read/mutation. Any helper
      // drift is treated as cleanup uncertainty even when the remote boundary was not reached.
      anchorRefreshMarkerApplyAttempted = true;
      const applied = await applyV207RollbackAnchorRefreshMarker(configPath);
      if (applied.sha256 !== V207_ANCHOR_REFRESH_ENABLED_SHA256 || applied.state !== "enabled") {
        throw new V207LiveOrchestratorError("V207_ANCHOR_REFRESH_MARKER_APPLY_UNCONFIRMED");
      }
      anchorRefreshMarkerApplied = true;
      protectedConfig = await readProtectedConfig(configPath);
      await record("rollback_anchor_refresh_marker_applied", {
        sha256: applied.sha256,
        mode: V207_ANCHOR_REFRESH_FILE_MODE,
      });
    }
    rollbackAnchorRefresh = resolveV207RollbackAnchorRefresh(environment, protectedConfig);
    if (rollbackAnchorRefresh.enabled && authority.anchorRefreshAuthorized !== true) {
      throw new V207LiveOrchestratorError("V207_ROLLBACK_ANCHOR_REFRESH_AUTHORITY_REQUIRED");
    }
    if (rollbackAnchorRefresh.enabled) {
      await record("rollback_anchor_refresh_authorized", {
        activation: V207_ROLLBACK_ANCHOR_REFRESH_ACTIVATION,
        authority_bound: true,
        config_bound: true,
      });
    }
    capturedAnchor = await statusVersion(run, cwd, configPath, environment, abortController.signal);
    initialRollbackAnchor = capturedAnchor;
    if (rollbackAnchorRefresh.enabled) {
      const expectedVersionIdHash =
        options.expectedOldActiveVersionIdSha256 ??
        V207_ANCHOR_REFRESH_EXPECTED_OLD_ACTIVE_VERSION_ID_SHA256;
      const expectedRecordHash =
        options.expectedOldActiveRecordSha256 ??
        V207_ANCHOR_REFRESH_EXPECTED_OLD_ACTIVE_RECORD_SHA256;
      if (
        sha256(capturedAnchor.versionId) !== expectedVersionIdHash ||
        capturedAnchor.sha256 !== expectedRecordHash
      ) {
        throw new V207LiveOrchestratorError("V207_ROLLBACK_ANCHOR_REFRESH_OLD_ANCHOR_MISMATCH");
      }
      await record("rollback_anchor_refresh_old_anchor_exact", {
        version_id_hash: sha256(capturedAnchor.versionId),
        rollback_anchor_sha256: capturedAnchor.sha256,
      });
    }
    const recentVersions = await recentWorkerVersions(
      run,
      cwd,
      configPath,
      environment,
      abortController.signal,
    );
    let rollbackAnchorIndex: number | null;
    try {
      rollbackAnchorIndex = assertV207WorkerRollbackAnchorRetained(
        recentVersions,
        capturedAnchor.versionId,
      );
    } catch (error) {
      if (
        !rollbackAnchorRefresh.enabled ||
        !(error instanceof V207LiveOrchestratorError) ||
        error.code !== "V207_WORKER_ROLLBACK_ANCHOR_NOT_RETAINED"
      ) {
        throw error;
      }
      // Refresh mode may proceed without an old retained anchor only because
      // every mismatch path below re-reads retention and becomes
      // CLEANUP_UNCERTAIN instead of issuing a blind rollback.
      rollbackAnchorIndex = null;
    }
    await record("captured_worker_version", {
      version_id_hash: sha256(capturedAnchor.versionId),
      rollback_anchor_sha256: capturedAnchor.sha256,
      recent_version_index: rollbackAnchorIndex,
      recent_version_window: V207_WORKER_VERSION_LIST_LIMIT,
      ...(rollbackAnchorIndex === null ? { retained: false } : { retained: true }),
    });
    // Capture the exact pre-mutation route semantics. The restored V2-06 Worker may legitimately
    // answer 503 (HOSTED_ROUTE_NOT_COMPOSED), so cleanup must compare against this fingerprint
    // instead of assuming the V2-07 route is always a 404 before/after the run.
    preMutationRoute = await readRouteFingerprint(
      fetchImpl,
      routeUrl,
      abortController.signal,
      rollbackAnchorRefresh.enabled,
    );
    if (
      rollbackAnchorRefresh.enabled &&
      preMutationRoute.workerVersionId !== capturedAnchor.versionId
    ) {
      throw new V207LiveOrchestratorError("V207_ROUTE_VERSION_ID_UNCONFIRMED");
    }
    await record("captured_pre_mutation_route", {
      status: preMutationRoute.status,
      code: preMutationRoute.code,
      ...(rollbackAnchorRefresh.enabled
        ? { worker_version_id_hash: sha256(capturedAnchor.versionId) }
        : {}),
    });
    if (rollbackAnchorRefresh.enabled) {
      if (
        preMutationRoute.status !== V207_REFRESH_DISABLED_ROUTE.status ||
        preMutationRoute.code !== V207_REFRESH_DISABLED_ROUTE.code
      ) {
        throw new V207LiveOrchestratorError("V207_ROLLBACK_ANCHOR_REFRESH_PRE_ROUTE_UNCONFIRMED");
      }
      const stablePreMutationRoute = await waitForRefreshDisabledRoute(
        fetchImpl,
        routeUrl,
        sleepImpl,
        abortController.signal,
        "V207_ROLLBACK_ANCHOR_REFRESH_PRE_ROUTE_UNCONFIRMED",
        capturedAnchor.versionId,
        true,
        async (count) => {
          await record("rollback_anchor_refresh_pre_mutation_route_transport_gap", {
            count,
          });
        },
      );
      await record("rollback_anchor_refresh_pre_mutation_route_stable", {
        status: stablePreMutationRoute.status,
        code: stablePreMutationRoute.code,
        worker_version_id_hash: sha256(capturedAnchor.versionId),
        consecutive_matches: RESTORATION_REQUIRED_CONSECUTIVE_MATCHES,
      });
    }

    const beforeSecrets = await secretNames(
      run,
      cwd,
      configPath,
      environment,
      abortController.signal,
    );
    if (rollbackAnchorRefresh.enabled && beforeSecrets.includes(V207_ORCHESTRATOR_SECRET_NAME)) {
      // Deleting an existing signer is a remote mutation. Refresh mode must prove the signer is
      // already absent before admission because an unretained old anchor cannot protect deletion.
      throw new V207LiveOrchestratorError("V207_ROLLBACK_ANCHOR_REFRESH_STALE_SIGNER_PRESENT");
    }

    // Capacity, rate, account, billing, inventory, image, and disabled-route admission are all
    // read-only. Run that complete gate after the rollback/route inputs are validated but before
    // deleting a stale signer, deploying a Worker, or creating a signer secret. A catalog-capacity
    // miss must be a zero-remote-mutation stop, not a deploy-and-rollback attempt.
    nonce = nonceFactory();
    if (!NONCE.test(nonce)) throw new V207LiveOrchestratorError("V207_NONCE_INVALID");
    const preflight = await run({
      command: qualificationCommand,
      args: [V207_READ_ONLY_ADMISSION_ENTRYPOINT],
      cwd: resolve(cwd, "apps/web"),
      env: commandEnvironment(environment, nonce, configPath, true),
      signal: abortController.signal,
    });
    if (preflight.exitCode !== 0) {
      childFailureCode = extractV207ChildFailureCode(preflight.stderr);
      throw new V207LiveOrchestratorError("V207_LIVE_PREFLIGHT");
    }
    await record("read_only_capacity_admission_completed", {
      exit_code: preflight.exitCode ?? -1,
    });

    if (!rollbackAnchorRefresh.enabled && beforeSecrets.includes(V207_ORCHESTRATOR_SECRET_NAME)) {
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

    if (rollbackAnchorRefresh.enabled) refreshValidationStarted = true;
    workerMutationMayExist = true;
    const signerDisabledDeploy = await run({
      command: "pnpm",
      args: ["--filter", "@videoforge/web", "exec", "wrangler", "deploy", "--config", configPath],
      cwd,
      env: redactEnvironment(environment),
      signal: abortController.signal,
    });
    if (signerDisabledDeploy.exitCode !== 0) {
      deployFailureDiagnostic = classifyV207WranglerDeployFailure(signerDisabledDeploy);
      throw new V207LiveOrchestratorError("V207_SIGNER_DISABLED_DEPLOY_FAILED");
    }
    await record("current_source_deployed_signer_disabled");

    if (rollbackAnchorRefresh.enabled) {
      const refreshedAnchor = await statusVersion(
        run,
        cwd,
        configPath,
        environment,
        abortController.signal,
      );
      if (
        capturedAnchor === undefined ||
        refreshedAnchor.versionId === capturedAnchor.versionId ||
        refreshedAnchor.sha256 === capturedAnchor.sha256
      ) {
        throw new V207LiveOrchestratorError("V207_ROLLBACK_ANCHOR_REFRESH_UNCHANGED");
      }
      // Read the exact active version before accepting any signer-disabled
      // route response. The control-plane status and data-plane header must
      // identify one immutable refreshed Worker version.
      const disabledRoute = await waitForRefreshDisabledRoute(
        fetchImpl,
        routeUrl,
        sleepImpl,
        abortController.signal,
        undefined,
        refreshedAnchor.versionId,
      );
      await record("rollback_anchor_refresh_disabled_route_stable", {
        status: disabledRoute.status,
        code: disabledRoute.code,
        worker_version_id_hash: sha256(refreshedAnchor.versionId),
        consecutive_matches: RESTORATION_REQUIRED_CONSECUTIVE_MATCHES,
      });
      const refreshedVersions = await recentWorkerVersions(
        run,
        cwd,
        configPath,
        environment,
        abortController.signal,
      );
      const refreshedAnchorIndex = assertV207WorkerRollbackAnchorRetained(
        refreshedVersions,
        refreshedAnchor.versionId,
      );
      await record("rollback_anchor_refresh_captured", {
        version_id_hash: sha256(refreshedAnchor.versionId),
        rollback_anchor_sha256: refreshedAnchor.sha256,
        recent_version_index: refreshedAnchorIndex,
        recent_version_window: V207_WORKER_VERSION_LIST_LIMIT,
      });
      const promotedDisabledRoute = await waitForRefreshDisabledRoute(
        fetchImpl,
        routeUrl,
        sleepImpl,
        abortController.signal,
        undefined,
        refreshedAnchor.versionId,
      );
      await record("rollback_anchor_refresh_post_promotion_route_stable", {
        status: promotedDisabledRoute.status,
        code: promotedDisabledRoute.code,
        worker_version_id_hash: sha256(refreshedAnchor.versionId),
        consecutive_matches: RESTORATION_REQUIRED_CONSECUTIVE_MATCHES,
      });
      capturedAnchor = refreshedAnchor;
      refreshCompleted = true;
    }

    nonceSecretMayExist = true;
    await putNonceSecret(run, cwd, configPath, environment, nonce, abortController.signal);
    const afterPut = await secretNames(run, cwd, configPath, environment, abortController.signal);
    if (!afterPut.includes(V207_ORCHESTRATOR_SECRET_NAME)) {
      throw new V207LiveOrchestratorError("V207_SIGNER_SECRET_PRESENCE_UNCONFIRMED");
    }
    await record("signer_secret_activated");
    // Secret activation creates a new immutable Worker version. Read back its exact active
    // version record before probing the route: UUID-only identity is insufficient because the
    // provider can expose a different deployment record under the same route. Keep the signer
    // version separate from capturedAnchor; cleanup must still roll back to the signer-disabled
    // anchor that was proven before qualification.
    signerActiveAnchor = await statusVersion(
      run,
      cwd,
      configPath,
      environment,
      abortController.signal,
    );
    if (
      capturedAnchor === undefined ||
      (signerActiveAnchor.versionId === capturedAnchor.versionId &&
        signerActiveAnchor.sha256 === capturedAnchor.sha256)
    ) {
      throw new V207LiveOrchestratorError("V207_SIGNER_ACTIVE_VERSION_UNCONFIRMED");
    }
    const activeSignerVersionId = signerActiveAnchor.versionId;
    await record("signer_active_worker_identity_confirmed", {
      version_id_hash: sha256(activeSignerVersionId),
      worker_record_sha256: signerActiveAnchor.sha256,
    });
    const activation = await waitForSignerRouteActivation(
      fetchImpl,
      routeUrl,
      sleepImpl,
      abortController.signal,
      activeSignerVersionId,
      async (count) => {
        await record("signer_route_activation_transport_gap", { count });
      },
    );
    await record("signer_route_activation_confirmed", {
      attempts: activation.attempts,
      status: activation.status,
    });
    await record("active_route_identity_confirmed", {
      attempts: activation.attempts,
      status: activation.status,
      worker_version_id_hash: sha256(activeSignerVersionId),
    });

    if (abortRequested) throw new V207LiveOrchestratorError("V207_OPERATOR_ABORT");
    const runner = await run({
      command: qualificationCommand,
      args: ["src/server/providers/v207-live-qualification.ts"],
      cwd: resolve(cwd, "apps/web"),
      env: commandEnvironment(environment, nonce, configPath),
      signal: abortController.signal,
    });
    runnerExitCode = runner.exitCode ?? -1;
    if (runner.exitCode !== 0) {
      childFailureCode = extractV207ChildFailureCode(runner.stderr);
      throw new V207LiveOrchestratorError("V207_LIVE_RUNNER_FAILED");
    }
    await record("live_runner_finished", { exit_code: runnerExitCode });
  } catch (error) {
    primaryError = error;
    // Evidence persistence must never prevent the finally-block cleanup from running.
    try {
      await record("orchestration_failed", {
        code: safeErrorCode(error),
        ...(childFailureCode === undefined ? {} : { child_failure_code: childFailureCode }),
        ...(deployFailureDiagnostic === undefined
          ? {}
          : {
              deploy_failure_class: deployFailureDiagnostic.failure_class,
              deploy_output_channel: deployFailureDiagnostic.output_channel,
              deploy_exit_code: deployFailureDiagnostic.exit_code,
              deploy_signal: deployFailureDiagnostic.signal,
            }),
      });
    } catch {
      // The initialized evidence path remains the only durable diagnostic; cleanup is still
      // attempted and any resulting uncertainty is surfaced as a bounded failure code.
    }
  } finally {
    if (nonceSecretMayExist) {
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
    let rollbackTargetAvailable = true;
    if (
      workerMutationMayExist &&
      rollbackAnchorRefresh.enabled &&
      refreshValidationStarted &&
      !refreshCompleted &&
      initialRollbackAnchor !== undefined
    ) {
      try {
        const latestVersions = await recentWorkerVersions(run, cwd, configPath, environment);
        assertV207WorkerRollbackAnchorRetained(latestVersions, initialRollbackAnchor.versionId);
      } catch {
        rollbackTargetAvailable = false;
        cleanupErrors.push("V207_ROLLBACK_ANCHOR_REFRESH_OLD_ANCHOR_NOT_RETAINED");
      }
    }
    if (workerMutationMayExist && capturedAnchor !== undefined && rollbackTargetAvailable) {
      try {
        await rollbackAndVerify(
          run,
          cwd,
          configPath,
          environment,
          capturedAnchor,
          undefined,
          rollbackAnchorRefresh.enabled && refreshValidationStarted && !refreshCompleted,
        );
        workerRollbackVerified = true;
        await record("worker_rolled_back", {
          version_id_hash: sha256(capturedAnchor.versionId),
          rollback_anchor_sha256: capturedAnchor.sha256,
        });
      } catch (error) {
        cleanupErrors.push(safeErrorCode(error));
      }
    } else if (workerMutationMayExist && rollbackTargetAvailable) {
      cleanupErrors.push("V207_ROLLBACK_TARGET_MISSING");
    } else if (workerMutationMayExist) {
      // A refresh mismatch may only fall back to the original anchor after a
      // fresh retention proof.  Do not issue a blind rollback or continue to
      // route/GPU work when that proof is unavailable.
      await record("worker_rollback_skipped_old_anchor_not_retained");
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
        const restoredAnchor = capturedAnchor;
        if (restoredAnchor === undefined) {
          cleanupErrors.push("V207_ROUTE_RESTORATION_VERSION_MISSING");
        } else {
          try {
            if (preMutationRoute === undefined) {
              cleanupErrors.push("V207_ROUTE_RESTORATION_FINGERPRINT_MISSING");
            } else {
              const expectedRestoredWorkerVersionId = rollbackAnchorRefresh.enabled
                ? restoredAnchor.versionId
                : undefined;
              const restoredRoute = await waitForRouteRestoration(
                fetchImpl,
                routeUrl,
                preMutationRoute,
                sleepImpl,
                options.routeRestorationSignal ??
                  AbortSignal.timeout(RESTORATION_PROPAGATION_WINDOW_MS),
                expectedRestoredWorkerVersionId,
              );
              await record("restored_route_confirmed", {
                status: restoredRoute.status,
                code: restoredRoute.code,
                ...(expectedRestoredWorkerVersionId === undefined
                  ? {}
                  : { worker_version_id_hash: sha256(expectedRestoredWorkerVersionId) }),
              });
            }
          } catch (error) {
            cleanupErrors.push(safeErrorCode(error));
          }
        }
      }
    } else {
      try {
        await record("disabled_route_probe_skipped_no_mutation");
      } catch {
        cleanupErrors.push("V207_EVIDENCE_PERSIST_FAILED");
      }
    }
    if (anchorRefreshMarkerApplied || anchorRefreshMarkerApplyAttempted) {
      if (!anchorRefreshMarkerApplied) {
        cleanupErrors.push("V207_ANCHOR_REFRESH_MARKER_APPLY_UNCERTAIN");
      }
      try {
        const reverted = await revertV207RollbackAnchorRefreshMarker(configPath);
        if (
          reverted.sha256 !== V207_ANCHOR_REFRESH_BASELINE_SHA256 ||
          reverted.state !== "disabled"
        ) {
          cleanupErrors.push("V207_ANCHOR_REFRESH_MARKER_REVERT_UNCONFIRMED");
        } else {
          anchorRefreshMarkerApplied = false;
          await record("rollback_anchor_refresh_marker_reverted", {
            sha256: reverted.sha256,
            mode: V207_ANCHOR_REFRESH_FILE_MODE,
          });
        }
      } catch (error) {
        cleanupErrors.push("V207_ANCHOR_REFRESH_MARKER_REVERT_UNCERTAIN");
        cleanupErrors.push(safeErrorCode(error));
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
  if (capturedAnchor === undefined || runnerExitCode === undefined) {
    throw new V207LiveOrchestratorError("V207_ORCHESTRATION_INCOMPLETE");
  }
  // The evidence excludes the nonce, RunPod key, signed URLs, and child output by construction.
  return {
    evidencePath: evidenceFile,
    capturedVersionIdHash: sha256(capturedAnchor.versionId),
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

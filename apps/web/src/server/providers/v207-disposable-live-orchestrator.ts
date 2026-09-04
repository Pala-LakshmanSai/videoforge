import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

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
  /(?:\b10090\b|worker(?: script)? [^\n]{0,120}(?:does not exist|not found)|no such worker)/iu;
const FINAL_PROOF_READS = 3;

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
}

export class V207DisposableOrchestratorError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "V207DisposableOrchestratorError";
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
  };
  if (request.args[5] !== V207_DISPOSABLE_WORKER_NAME) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_DELETE_TARGET_UNBOUND");
  }
  return run(request);
}

function provesWorkerAbsent(result: V207CommandResult): boolean {
  if (result.exitCode === 0 || result.signal !== null) return false;
  const diagnostic = `${result.stdout.slice(0, 131_072)}\n${result.stderr.slice(0, 131_072)}`;
  return ABSENT_DIAGNOSTIC.test(diagnostic);
}

async function assertWorkerAbsent(
  run: V207CommandRunner,
  cwd: string,
  configPath: string,
  environment: Environment,
): Promise<void> {
  const result = await runWrangler(run, cwd, configPath, environment, [
    "deployments",
    "status",
    "--json",
  ]);
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

async function readRoute(
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
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_ROUTE_UNREACHABLE");
  }
  let value: unknown;
  try {
    value = (await response.json()) as unknown;
  } catch {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_ROUTE_INVALID");
  }
  const valueRecord =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const errorRecord =
    typeof valueRecord?.error === "object" && valueRecord.error !== null
      ? (valueRecord.error as Record<string, unknown>)
      : null;
  const code = errorRecord?.code ?? "";
  if (typeof code !== "string" || !SAFE_CODE.test(code)) {
    throw new V207DisposableOrchestratorError("V207_DISPOSABLE_ROUTE_INVALID");
  }
  return { status: response.status, code };
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
  for (let index = 0; index < reads; index += 1) {
    const observed = await readRoute(fetchImpl, routeUrl, signal);
    if (observed.status !== expected.status || observed.code !== expected.code) {
      throw new V207DisposableOrchestratorError(errorCode);
    }
    if (index + 1 < reads) await sleepImpl(2_000);
  }
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
  const configPath = resolve(options.configPath ?? V207_DISPOSABLE_CONFIG);
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

  await assertWorkerAbsent(run, cwd, configPath, environment);
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

    await assertStableRoute(
      fetchImpl,
      routeUrl,
      { status: 403, code: "V207_AUTHORITY_REJECTED" },
      FINAL_PROOF_READS,
      sleepImpl,
      "V207_DISPOSABLE_ACTIVE_ROUTE_UNCONFIRMED",
      abortController.signal,
    );
    await record("active_route_confirmed", { reads: FINAL_PROOF_READS });

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
          requireSuccess(
            "V207_DISPOSABLE_DELETE_FAILED",
            await deleteDisposableWorker(run, cwd, configPath, environment),
          );
          for (let read = 1; read <= FINAL_PROOF_READS; read += 1) {
            await assertWorkerAbsent(run, cwd, configPath, environment);
            await assertDataPlaneAbsent(fetchImpl, routeUrl);
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

import { setTimeout as waitForPropagation } from "node:timers/promises";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runCancellableChildProcess } from "../v2-13/full-live-adapters.mjs";
import {
  APPROVED_WRANGLER_OAUTH_SCOPES,
  cloudflareOAuthApiResponse,
  extractSingleActiveVersion,
  SECRET_NAMES,
  WORKERS_SUBDOMAIN_PATH,
  WORKFLOW_INVENTORY_PATH,
} from "../v2-13/guarded-activation.mjs";
import {
  ACTIVATED_ASSETS_PATH,
  ACTIVATED_MAIN_PATH,
  validateProductionConfig,
} from "../v2-13/validate-production-config.mjs";

import { hashV209DryOutputBundle } from "./dry-output-bundle.mjs";
import { executeV209SecretBulk } from "./cloudflare-secret-bulk.mjs";

const SOURCE_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const JOURNAL_SCHEMA = "videoforge.v2-09-cloudflare-production-journal/v1";
const PORT_SCHEMA = "videoforge.v2-09-cloudflare-production-port/v1";
const STATUS_PATH = "/api/v2/hosted/status";
const VERSION_HEADER = "x-videoforge-worker-version";
const IMPORTED_DEPENDENCY_PATHS = Object.freeze([
  "deploy/v2-09/cloudflare-secret-bulk.mjs",
  "deploy/v2-09/dry-output-bundle.mjs",
  "deploy/v2-13/full-live-adapters.mjs",
  "deploy/v2-13/guarded-activation.mjs",
  "deploy/v2-13/validate-production-config.mjs",
]);
const CONFIGURATION_KEYS = Object.freeze([
  "bootstrapConfigPath",
  "disabledConfigPath",
  "environment",
  "expectedOauthScopes",
  "journalPath",
  "oauthConfigPath",
  "qualifiedConfigPath",
  "root",
  "secretFiles",
  "sourceCommit",
  "workerName",
]);
const ENVIRONMENT_KEYS = new Set([
  "CI",
  "HOME",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "PATH",
  "TMPDIR",
  "WRANGLER_HOME",
  "WRANGLER_SEND_METRICS",
  "XDG_CONFIG_HOME",
]);

function fail(code) {
  throw new Error(`V2_09_CLOUDFLARE_PRODUCTION_${code}`);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseJson(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    fail(code);
  }
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function privateDirectory(path) {
  const stat = lstatSync(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    fail("PRIVATE_DIRECTORY_INVALID");
}

function privateFile(path, { mayNotExist = false } = {}) {
  if (typeof path !== "string" || !isAbsolute(path)) fail("PRIVATE_PATH_INVALID");
  privateDirectory(dirname(path));
  if (mayNotExist && !existsSync(path)) return;
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.nlink !== 1 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    fail("PRIVATE_FILE_INVALID");
}

function sealSecretInputs(configuration) {
  return Object.freeze(
    Object.fromEntries(
      SECRET_NAMES.map((name) => {
        const path = configuration.secretFiles[name];
        let descriptor;
        let before;
        let after;
        let bytes;
        try {
          descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
          before = fstatSync(descriptor);
          bytes = Buffer.from(readFileSync(descriptor));
          after = fstatSync(descriptor);
        } catch {
          fail("SECRET_SNAPSHOT_INVALID");
        } finally {
          if (descriptor !== undefined) closeSync(descriptor);
        }
        if (
          !before.isFile() ||
          before.nlink !== 1 ||
          (before.mode & 0o777) !== 0o600 ||
          (typeof process.getuid === "function" && before.uid !== process.getuid()) ||
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.mode !== after.mode ||
          before.uid !== after.uid ||
          before.nlink !== after.nlink ||
          before.size !== after.size ||
          before.size !== bytes.length ||
          bytes.length === 0
        )
          fail("SECRET_SNAPSHOT_INVALID");
        return [name, Object.freeze({ bytes, sha256: sha256(bytes) })];
      }),
    ),
  );
}

function writePrivateJson(path, value) {
  privateFile(path, { mayNotExist: true });
  const temporary = `${path}.next`;
  if (existsSync(temporary)) fail("PRIVATE_TEMP_EXISTS");
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    writeFileSync(descriptor, `${canonical(value)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), fsConstants.O_RDONLY);
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function exactOrigin(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

function parseInstant(value, code) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value))
    fail(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code);
  return parsed;
}

function readClock(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("CLOCK_INVALID");
  return value;
}

function assertCurrentAuthority(authority, configuration, now) {
  const observed = readClock(now);
  const issuedAt = parseInstant(authority?.issued_at, "AUTHORITY_TIME_INVALID");
  const expiresAt = parseInstant(authority?.expires_at, "AUTHORITY_TIME_INVALID");
  if (
    !COMMIT.test(authority?.source_commit ?? "") ||
    authority.source_commit !== configuration.sourceCommit ||
    issuedAt >= expiresAt ||
    observed.getTime() < issuedAt ||
    observed.getTime() >= expiresAt ||
    typeof authority.authority_id !== "string" ||
    authority.authority_id.length < 8 ||
    !HASH.test(authority.proposal_sha256 ?? "") ||
    authority.production?.worker_name !== configuration.workerName ||
    !HASH.test(authority.production?.config_sha256 ?? "") ||
    !HASH.test(authority.production?.worker_bundle_sha256 ?? "") ||
    !HASH.test(authority.production?.secret_allowlist_sha256 ?? "") ||
    authority.production?.secret_count !== SECRET_NAMES.length
  )
    fail("AUTHORITY_NOT_CURRENT");
  return observed;
}

function assertCleanupAuthorityBase(authority, configuration, now) {
  const observed = readClock(now);
  const issuedAt = parseInstant(authority?.issued_at, "AUTHORITY_TIME_INVALID");
  const expiresAt = parseInstant(authority?.expires_at, "AUTHORITY_TIME_INVALID");
  if (
    !COMMIT.test(authority?.source_commit ?? "") ||
    authority.source_commit !== configuration.sourceCommit ||
    issuedAt >= expiresAt ||
    observed.getTime() < issuedAt ||
    typeof authority.authority_id !== "string" ||
    authority.authority_id.length < 8 ||
    !HASH.test(authority.proposal_sha256 ?? "") ||
    authority.production?.worker_name !== configuration.workerName ||
    !HASH.test(authority.production?.secret_allowlist_sha256 ?? "") ||
    authority.production?.secret_count !== SECRET_NAMES.length ||
    authority.scope?.cleanup_only_recovery !== true ||
    authority.scope?.allow_redispatch !== false ||
    !Array.isArray(authority.scope?.operations) ||
    !authority.scope.operations.includes("reconcile-v209-production-safety")
  )
    fail("CLEANUP_AUTHORITY_INVALID");
  return observed;
}

function assertCleanupAuthority(authority, configuration, now) {
  const observed = assertCleanupAuthorityBase(authority, configuration, now);
  if (
    !HASH.test(authority.production?.config_sha256 ?? "") ||
    !HASH.test(authority.production?.worker_bundle_sha256 ?? "")
  )
    fail("CLEANUP_AUTHORITY_INVALID");
  return observed;
}

function isPreRenderCleanupAuthority(authority, configuration, now) {
  if (
    authority?.execution !== "V2_09_PREFLIGHT_THEN_QUALIFIED_PRODUCTION_ONCE" ||
    !exactKeys(authority.production, [
      "chrome_bootstrap_plan_sha256",
      "materialization_input_sha256",
      "secret_allowlist_sha256",
      "secret_count",
      "worker_name",
    ])
  )
    return false;
  assertCleanupAuthorityBase(authority, configuration, now);
  if (
    !HASH.test(authority.production.chrome_bootstrap_plan_sha256 ?? "") ||
    !HASH.test(authority.production.materialization_input_sha256 ?? "") ||
    authority.production.secret_allowlist_sha256 !== sha256(canonical([...SECRET_NAMES].sort()))
  )
    fail("CLEANUP_AUTHORITY_INVALID");
  return true;
}

function assertOperationContext(context, operationId) {
  if (
    context === null ||
    typeof context !== "object" ||
    context.operationId !== operationId ||
    context.cleanupOnly === true ||
    context.mode === "DRY_RUN"
  )
    fail("OPERATION_CONTEXT_INVALID");
}

function assertConfiguration(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify(
        [
          ...CONFIGURATION_KEYS,
          ...(Object.hasOwn(value, "predecessorBaseline") ? ["predecessorBaseline"] : []),
        ].sort(),
      ) ||
    resolve(value.root ?? "") !== ROOT ||
    !COMMIT.test(value.sourceCommit ?? "") ||
    value.workerName !== "videoforge-production-runtime" ||
    value.environment === null ||
    typeof value.environment !== "object" ||
    Array.isArray(value.environment)
  )
    fail("CONFIGURATION_INVALID");
  if (Object.hasOwn(value, "predecessorBaseline")) {
    const baseline = value.predecessorBaseline;
    if (
      !exactKeys(baseline, [
        "versionId",
        "sourceCommit",
        "qualifiedConfigPath",
        "qualifiedConfigSha256",
      ]) ||
      !UUID.test(baseline.versionId ?? "") ||
      !COMMIT.test(baseline.sourceCommit ?? "") ||
      !HASH.test(baseline.qualifiedConfigSha256 ?? "")
    )
      fail("PREDECESSOR_DESCRIPTOR_INVALID");
    privateFile(baseline.qualifiedConfigPath);
    if (sha256(readFileSync(baseline.qualifiedConfigPath)) !== baseline.qualifiedConfigSha256)
      fail("PREDECESSOR_CONFIG_HASH_DRIFT");
  }
  // The deployment adapter is bound immediately after endpoint-secret materialization,
  // before the next operation renders this exact qualified configuration.
  privateFile(value.qualifiedConfigPath, { mayNotExist: true });
  for (const path of Object.values(value.secretFiles ?? {})) privateFile(path);
  privateFile(value.oauthConfigPath);
  for (const path of [value.disabledConfigPath, value.bootstrapConfigPath, value.journalPath])
    privateFile(path, { mayNotExist: true });
  if (
    JSON.stringify(Object.keys(value.secretFiles ?? {}).sort()) !==
      JSON.stringify([...SECRET_NAMES].sort()) ||
    new Set(Object.values(value.secretFiles)).size !== SECRET_NAMES.length
  )
    fail("SECRET_FILE_SET_INVALID");
  if (JSON.stringify(value.expectedOauthScopes) !== JSON.stringify(APPROVED_WRANGLER_OAUTH_SCOPES))
    fail("OAUTH_SCOPE_SET_INVALID");
  const environment = Object.entries(value.environment);
  if (
    environment.some(
      ([name, entry]) =>
        !ENVIRONMENT_KEYS.has(name) ||
        typeof entry !== "string" ||
        entry.includes("\0") ||
        entry.length > 8192,
    )
  )
    fail("ENVIRONMENT_INVALID");
  return Object.freeze({
    ...(value.predecessorBaseline
      ? { predecessorBaseline: Object.freeze({ ...value.predecessorBaseline }) }
      : {}),
    root: value.root,
    sourceCommit: value.sourceCommit,
    workerName: value.workerName,
    qualifiedConfigPath: value.qualifiedConfigPath,
    disabledConfigPath: value.disabledConfigPath,
    bootstrapConfigPath: value.bootstrapConfigPath,
    journalPath: value.journalPath,
    oauthConfigPath: value.oauthConfigPath,
    expectedOauthScopes: Object.freeze([...value.expectedOauthScopes]),
    secretFiles: Object.freeze({ ...value.secretFiles }),
    environment: Object.freeze(Object.fromEntries(environment)),
  });
}

const PREDECESSOR_ARTIFACT_ROOT = Symbol("v209 exact predecessor artifact root");

function predecessorArtifactPaths(root) {
  if (typeof root !== "string" || !isAbsolute(root) || resolve(root) !== root)
    fail("PREDECESSOR_ARTIFACT_ROOT_INVALID");
  privateDirectory(root);
  let dist = root;
  for (const segment of ["apps", "web", "dist-cloudflare"]) {
    dist = resolve(dist, segment);
    privateDirectory(dist);
  }
  const worker = resolve(dist, "videoforge_production_runtime");
  const main = resolve(worker, "index.js");
  const assets = resolve(dist, "client");
  privateDirectory(worker);
  privateDirectory(assets);
  privateFile(main);
  return Object.freeze({ worker, main, assets });
}

function validatePredecessorArtifactTree(root) {
  const paths = predecessorArtifactPaths(root);
  const visit = (path) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) fail("PREDECESSOR_ARTIFACT_PATH_DRIFT");
    if (stat.isDirectory()) {
      privateDirectory(path);
      for (const name of readdirSync(path)) visit(resolve(path, name));
      return;
    }
    if (!stat.isFile()) fail("PREDECESSOR_ARTIFACT_PATH_DRIFT");
    privateFile(path);
  };
  visit(paths.worker);
  visit(paths.assets);
  return paths;
}

function qualifiedConfiguration(configuration, authority) {
  privateFile(configuration.qualifiedConfigPath);
  const bytes = readFileSync(configuration.qualifiedConfigPath);
  if (sha256(bytes) !== authority.production.config_sha256) fail("QUALIFIED_CONFIG_HASH_DRIFT");
  const value = parseJson(bytes.toString("utf8"), "QUALIFIED_CONFIG_JSON_INVALID");
  const predecessorRoot = configuration[PREDECESSOR_ARTIFACT_ROOT];
  // The pinned predecessor config retains the absolute paths from its original
  // checkout. Validate those bytes as-is; the separately bound artifact root is
  // a relocation-only copy used for path and symlink checks and must not rewrite
  // or re-hash the historical config.
  // Historical predecessor bytes retain the frozen shared no-bundle contract and are accepted
  // only with their separately verified relocated artifact root. New V2-09 deployments must let
  // Wrangler bundle the generated Vite module graph so sibling chunks cannot be omitted.
  if (predecessorRoot === undefined && value.no_bundle !== false)
    fail("QUALIFIED_BUNDLE_MODE_DRIFT");
  if (predecessorRoot !== undefined && value.no_bundle !== true)
    fail("PREDECESSOR_BUNDLE_MODE_DRIFT");
  const validationValue = structuredClone(value);
  validationValue.no_bundle = true;
  validateProductionConfig(validationValue, { mode: "qualified" });
  if (predecessorRoot !== undefined) validatePredecessorArtifactTree(predecessorRoot);
  const workflowNames = value.workflows.map(({ name }) => name);
  if (
    value.name !== configuration.workerName ||
    value.vars?.VIDEOFORGE_COMMIT !== authority.source_commit ||
    value.vars?.VIDEOFORGE_ENVIRONMENT !== "production" ||
    value.vars?.VIDEOFORGE_PROVIDER_MODE !== "production" ||
    value.vars?.VIDEOFORGE_GPU_TRANSPORT !== "QUALIFIED_EXACT" ||
    !exactOrigin(value.vars?.VIDEOFORGE_PUBLIC_ORIGIN) ||
    new Set(workflowNames).size !== 2
  )
    fail("QUALIFIED_CONFIG_DRIFT");
  const video = value.workflows.filter(({ binding }) => binding === "VIDEO_WORKFLOW");
  const pair = value.workflows.filter(({ binding }) => binding === "HOSTED_PAIR_WORKFLOW");
  if (
    video.length !== 1 ||
    pair.length !== 1 ||
    video[0].class_name !== "HostedVideoWorkflow" ||
    pair[0].class_name !== "HostedPairWorkflow"
  )
    fail("QUALIFIED_WORKFLOW_DRIFT");
  return Object.freeze({ bytes, value });
}

function materializeDisabled(configuration, authority) {
  const qualified = qualifiedConfiguration(configuration, authority).value;
  const disabled = structuredClone(qualified);
  disabled.vars.VIDEOFORGE_GPU_TRANSPORT = "DISABLED_UNQUALIFIED";
  // qualifiedConfiguration already validates the exact two independently named
  // V2-09 Workflows. Bootstrap removes only R2; V2-13's name-suffix convention
  // is not part of this checkpoint's approved configuration.
  const bootstrap = structuredClone(disabled);
  delete bootstrap.r2_buckets;
  if (Object.hasOwn(bootstrap, "r2_buckets")) fail("BOOTSTRAP_R2_PRESENT");
  writePrivateJson(configuration.disabledConfigPath, disabled);
  writePrivateJson(configuration.bootstrapConfigPath, bootstrap);
  return Object.freeze({
    bootstrap,
    disabled,
    disabledSha256: sha256(readFileSync(configuration.disabledConfigPath)),
  });
}

function newJournal(authority, configuration) {
  return {
    schema_version: JOURNAL_SCHEMA,
    authority_id: authority.authority_id,
    proposal_sha256: authority.proposal_sha256,
    source_commit: authority.source_commit,
    worker: configuration.workerName,
    config_sha256: authority.production.config_sha256,
    state: "PREPARED",
    active_version_id: null,
    worker_bundle_sha256: null,
    introduced_secret_names: [],
    events: [],
    retained_r2_deleted: false,
  };
}

const FAILURE_CODES = new Set([
  ...[
    "WORKER_INVALID",
    "DIRECTORY_INVALID",
    "PATH_INVALID",
    "SYMLINK",
    "ENTRY_INVALID",
    "RACE",
    "README_INVALID",
    "README_MISSING",
    "ENTRYPOINT_MISSING",
    "READ_FAILED",
  ].map((code) => `V2_09_DRY_OUTPUT_${code}`),
  ...[
    "INJECTION_FORBIDDEN",
    "INPUT_INVALID",
    "CREDENTIAL_INVALID",
    "CANCELLED",
    "OAUTH_READBACK_FAILED",
    "AUTHORITY_RECHECK_FAILED",
    "OUTCOME_UNKNOWN",
    "AUTHORITY_EXPIRED",
  ].map((code) => `V2_09_CLOUDFLARE_SECRET_BULK_${code}`),
  "UNKNOWN_ERROR",
  ...[
    "PREDECESSOR_DESCRIPTOR_INVALID",
    "PREDECESSOR_CONFIG_HASH_DRIFT",
    "PREDECESSOR_CONFIG_INVALID",
    "PREDECESSOR_BINDING_DRIFT",
    "PREDECESSOR_VERSION_DRIFT",
    "PREDECESSOR_SECRETS_PRESENT",
    "PREDECESSOR_WORKER_ABSENT",
    "PREDECESSOR_WORKFLOW_DRIFT",
    "ACTIVE_VERSION_CLOSED_WORLD_DRIFT",
    "ACTIVE_VERSION_ID_INVALID",
    "ROUTE_TRANSPORT_FAILED",
    "ROUTE_BODY_FAILED",
    "ROUTE_BODY_INVALID",
    "ROUTE_JSON_INVALID",
    "ROUTE_READBACK_DRIFT",
    "ROUTE_CONTENT_TYPE_DRIFT",
    "ROUTE_VERSION_HEADER_DRIFT",
    "ROUTE_MISSING_CONFIGURATION_DRIFT",
    "ROUTE_HTTP_STATUS_DRIFT",
    "ROUTE_SCHEMA_DRIFT",
    "ROUTE_SOURCE_DRIFT",
    "ROUTE_ENVIRONMENT_DRIFT",
    "ROUTE_TRANSPORT_DRIFT",

    "SECRET_LIST_FAILED",
    "SECRET_DELETE_FAILED",
    "SAFE_CLEAN_SECRET_DRIFT",
    "SAFE_CLEAN_VERSION_DRIFT",
    "CLEANUP_SECRET_ATTRIBUTION_DRIFT",
    "SECRET_DELETE_REPLAY_FORBIDDEN",
    "SECRET_READBACK_CANCELLED",
    "RECONCILIATION_SECRET_SET_NOT_EMPTY",
    "SECRET_PUT_FAILED",
    "SECRET_BULK_FAILED",
    "WORKER_BUNDLE_HASH_DRIFT",
    "BUNDLE_DRY_RUN_FAILED",
    "BUNDLE_DRY_RUN_TIMEOUT",
    "BUNDLE_DRY_RUN_CANCELLED",
    "UPLOAD_ARTIFACT_INVALID",
    "UPLOAD_ARTIFACT_NOT_IMMUTABLE",
    "UPLOAD_CONFIG_BYTES_INVALID",
    "UPLOAD_ARTIFACT_SYMLINK",
    "UPLOAD_ARTIFACT_ENTRY_INVALID",
    "SECRET_BULK_REPLAY_FORBIDDEN",
    "DEPLOYMENT_STATUS_FAILED",
    "VERSION_READBACK_FAILED",
    "DISABLED_RECONCILE_DEPLOY_FAILED",
    "FAILURE_RECONCILIATION_REQUIRED",
  ].map((code) => `V2_09_CLOUDFLARE_PRODUCTION_${code}`),
]);
const safeFailureCode = (error) =>
  FAILURE_CODES.has(error?.message) ? error.message : "UNKNOWN_ERROR";

function validateJournal(value, authority, configuration) {
  if (
    !exactKeys(value, [
      "active_version_id",
      "authority_id",
      "config_sha256",
      "events",
      "introduced_secret_names",
      "proposal_sha256",
      "retained_r2_deleted",
      "schema_version",
      "source_commit",
      "state",
      "worker",
      "worker_bundle_sha256",
      ...(Object.hasOwn(value ?? {}, "failure") ? ["failure"] : []),
    ]) ||
    (Object.hasOwn(value ?? {}, "failure") &&
      (!exactKeys(value.failure, ["operation_code", "cleanup_code"]) ||
        !FAILURE_CODES.has(value.failure.operation_code) ||
        !(value.failure.cleanup_code === null || FAILURE_CODES.has(value.failure.cleanup_code)))) ||
    value.schema_version !== JOURNAL_SCHEMA ||
    value.authority_id !== authority.authority_id ||
    value.proposal_sha256 !== authority.proposal_sha256 ||
    value.source_commit !== authority.source_commit ||
    value.worker !== configuration.workerName ||
    value.config_sha256 !== authority.production.config_sha256 ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.introduced_secret_names) ||
    value.introduced_secret_names.some((name) => !SECRET_NAMES.includes(name)) ||
    value.retained_r2_deleted !== false
  )
    fail("JOURNAL_INVALID");
  return value;
}

function loadJournal(authority, configuration) {
  if (!existsSync(configuration.journalPath)) {
    const value = newJournal(authority, configuration);
    writePrivateJson(configuration.journalPath, value);
    return value;
  }
  privateFile(configuration.journalPath);
  return validateJournal(
    parseJson(readFileSync(configuration.journalPath, "utf8"), "JOURNAL_JSON_INVALID"),
    authority,
    configuration,
  );
}

function saveJournal(journal, configuration) {
  if (journal.retained_r2_deleted !== false) fail("R2_RETENTION_VIOLATION");
  writePrivateJson(configuration.journalPath, journal);
}

function record(journal, configuration, event) {
  journal.events.push(Object.freeze({ sequence: journal.events.length + 1, ...event }));
  saveJournal(journal, configuration);
}

function timeoutFor(authority, observed) {
  return Math.max(1, Math.min(15 * 60_000, Date.parse(authority.expires_at) - observed.getTime()));
}

async function child(
  runtime,
  authority,
  args,
  code,
  { input, mutation = false, cleanupMutation = false, context } = {},
) {
  const observed = mutation
    ? cleanupMutation
      ? assertCleanupAuthority(authority, runtime.configuration, runtime.now)
      : assertCurrentAuthority(authority, runtime.configuration, runtime.now)
    : readClock(runtime.now);
  if (args.includes("r2") || (args.includes("delete") && args[0] !== "secret"))
    fail("FORBIDDEN_DELETION_COMMAND");
  const result = await runtime.runChild({
    command: "pnpm",
    args: ["--filter", "@videoforge/web", "exec", "wrangler", ...args],
    timeoutMs: mutation && !cleanupMutation ? timeoutFor(authority, observed) : 15 * 60_000,
    cancellationSignal: context?.cancellationSignal,
    timeoutCode: `V2_09_CLOUDFLARE_PRODUCTION_${code}_TIMEOUT`,
    cancellationCode: `V2_09_CLOUDFLARE_PRODUCTION_${code}_CANCELLED`,
    executionCode: `V2_09_CLOUDFLARE_PRODUCTION_${code}_FAILED`,
    options: {
      cwd: runtime.configuration.root,
      env: runtime.configuration.environment,
      input,
      maxBuffer: 4 * 1024 * 1024,
    },
  });
  if (result.status !== 0 || result.signal !== null) fail(`${code}_FAILED`);
  return result.stdout.trim();
}

async function mutate(runtime, authority, journal, context, kind, args, code, options = {}) {
  const observed = options.cleanup
    ? assertCleanupAuthority(authority, runtime.configuration, runtime.now)
    : assertCurrentAuthority(authority, runtime.configuration, runtime.now);
  const detail = options.name === undefined ? {} : { name: options.name };
  record(journal, runtime.configuration, {
    status: "INTENT",
    operation_id: context.operationId,
    kind,
    observed_at: observed.toISOString(),
    ...detail,
  });
  try {
    const output = await child(runtime, authority, args, code, {
      context,
      input: options.input,
      mutation: true,
      cleanupMutation: options.cleanup === true,
    });
    record(journal, runtime.configuration, {
      status: "COMMITTED",
      operation_id: context.operationId,
      kind,
      observed_at: readClock(runtime.now).toISOString(),
      ...detail,
    });
    return output;
  } catch (error) {
    record(journal, runtime.configuration, {
      status: "UNKNOWN",
      operation_id: context.operationId,
      kind,
      observed_at: readClock(runtime.now).toISOString(),
      ...detail,
    });
    throw error;
  }
}

function apiEnvelope(response, code) {
  const value = parseJson(response?.bytes, `${code}_JSON_INVALID`);
  if (
    !exactKeys(value, ["body", "status"]) ||
    !Number.isSafeInteger(value.status) ||
    value.body === null ||
    typeof value.body !== "object"
  )
    fail(`${code}_SHAPE_INVALID`);
  return value;
}

function resourceNames(envelope, code) {
  if (envelope.status !== 200 || envelope.body?.success !== true) fail(`${code}_FAILED`);
  const result = envelope.body.result;
  const items = Array.isArray(result)
    ? result
    : Array.isArray(result?.buckets)
      ? result.buckets
      : null;
  if (items === null || items.some((item) => typeof item?.name !== "string"))
    fail(`${code}_RESULT_INVALID`);
  const names = items.map(({ name }) => name).sort();
  if (new Set(names).size !== names.length) fail(`${code}_DUPLICATE`);
  const info = envelope.body.result_info ?? result?.result_info;
  if (
    !info ||
    typeof info !== "object" ||
    info.page !== 1 ||
    !Number.isSafeInteger(info.total_pages) ||
    info.total_pages !== 1 ||
    !Number.isSafeInteger(info.total_count) ||
    info.total_count !== names.length
  )
    fail(`${code}_PAGINATION_INVALID`);
  return names;
}

function r2BucketNames(envelope) {
  const code = "R2_INVENTORY";
  if (envelope.status !== 200 || envelope.body?.success !== true) fail(`${code}_FAILED`);
  const body = envelope.body;
  if (
    !exactKeys(body, ["success", "errors", "messages", "result"]) ||
    !Array.isArray(body.errors) ||
    body.errors.length !== 0 ||
    !Array.isArray(body.messages) ||
    body.messages.length !== 0 ||
    !exactKeys(body.result, ["buckets"]) ||
    !Array.isArray(body.result.buckets) ||
    body.result.buckets.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof item.name !== "string" ||
        item.name.length === 0 ||
        Object.keys(item).some((key) =>
          [
            "cursor",
            "next_cursor",
            "truncated",
            "is_truncated",
            "continuation_token",
            "result_info",
          ].includes(key),
        ),
    )
  )
    fail(`${code}_RESULT_INVALID`);
  const names = body.result.buckets.map(({ name }) => name).sort();
  if (new Set(names).size !== names.length) fail(`${code}_DUPLICATE`);
  return names;
}

async function oauthRead(runtime, qualified, path, code) {
  const response = await runtime.oauthApiResponse({
    accountId: qualified.account_id,
    configPath: runtime.configuration.oauthConfigPath,
    environment: runtime.configuration.environment,
    expectedScopes: runtime.configuration.expectedOauthScopes,
    fetchImpl: runtime.fetchImpl,
    path,
    ...(runtime.oauthSpawn === undefined ? {} : { spawn: runtime.oauthSpawn }),
  });
  return apiEnvelope(response, code);
}

async function verifyPredecessorBaseline(runtime, authority, context, qualified) {
  const baseline = runtime.configuration.predecessorBaseline;
  privateFile(baseline.qualifiedConfigPath);
  const bytes = readFileSync(baseline.qualifiedConfigPath);
  if (sha256(bytes) !== baseline.qualifiedConfigSha256) fail("PREDECESSOR_CONFIG_HASH_DRIFT");
  const previous = parseJson(bytes, "PREDECESSOR_CONFIG_INVALID");
  if (
    previous.name !== qualified.name ||
    previous.account_id !== qualified.account_id ||
    previous.vars?.VIDEOFORGE_COMMIT !== baseline.sourceCommit ||
    previous.vars?.VIDEOFORGE_PUBLIC_ORIGIN !== qualified.vars.VIDEOFORGE_PUBLIC_ORIGIN ||
    canonical(previous.workflows) !== canonical(qualified.workflows) ||
    canonical(previous.r2_buckets) !== canonical(qualified.r2_buckets)
  )
    fail("PREDECESSOR_BINDING_DRIFT");
  const status = await child(
    runtime,
    authority,
    [
      "deployments",
      "status",
      "--json",
      "--name",
      qualified.name,
      "--config",
      runtime.configuration.disabledConfigPath,
    ],
    "DEPLOYMENT_STATUS",
    { context },
  );
  const versionId = extractSingleActiveVersion(status);
  if (versionId !== baseline.versionId) fail("PREDECESSOR_VERSION_DRIFT");
  const version = parseJson(
    await child(
      runtime,
      authority,
      [
        "versions",
        "view",
        versionId,
        "--json",
        "--name",
        qualified.name,
        "--config",
        runtime.configuration.disabledConfigPath,
      ],
      "VERSION_READBACK",
      { context },
    ),
    "VERSION_READBACK_JSON_INVALID",
  );
  normalizedVersionProjection(version, previous, "DISABLED_UNQUALIFIED", true, []);
  if ((await exactSecretNames(runtime, authority, context)).length !== 0)
    fail("PREDECESSOR_SECRETS_PRESENT");
  await readRoute(
    runtime,
    authority,
    versionId,
    "DISABLED_UNQUALIFIED",
    context,
    true,
    baseline.sourceCommit,
  );
}

async function exactPreMutationInventory(runtime, authority, context, journal) {
  const qualified = qualifiedConfiguration(runtime.configuration, authority).value;
  const account = await oauthRead(runtime, qualified, "/", "ACCOUNT_INVENTORY");
  if (
    account.status !== 200 ||
    account.body?.success !== true ||
    account.body?.result?.id !== qualified.account_id
  )
    fail("ACCOUNT_INVENTORY_DRIFT");
  const subdomain = await oauthRead(runtime, qualified, WORKERS_SUBDOMAIN_PATH, "ORIGIN_INVENTORY");
  const exactPublicOrigin = `https://${qualified.name}.${subdomain.body?.result?.subdomain}.workers.dev`;
  if (
    subdomain.status !== 200 ||
    subdomain.body?.success !== true ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/u.test(subdomain.body?.result?.subdomain ?? "") ||
    exactPublicOrigin !== qualified.vars.VIDEOFORGE_PUBLIC_ORIGIN
  )
    fail("ORIGIN_INVENTORY_DRIFT");
  const worker = await oauthRead(
    runtime,
    qualified,
    `/workers/scripts/${qualified.name}/settings`,
    "WORKER_INVENTORY",
  );
  const workerAbsent = worker.status === 404;
  if (!workerAbsent && (worker.status !== 200 || worker.body?.success !== true))
    fail("WORKER_INVENTORY_DRIFT");
  const workflowNames = resourceNames(
    await oauthRead(runtime, qualified, WORKFLOW_INVENTORY_PATH, "WORKFLOW_INVENTORY"),
    "WORKFLOW_INVENTORY",
  );
  const intendedWorkflows = qualified.workflows.map(({ name }) => name).sort();
  const presentIntended = workflowNames.filter((name) => intendedWorkflows.includes(name));
  const bucketNames = r2BucketNames(
    await oauthRead(runtime, qualified, "/r2/buckets", "R2_INVENTORY"),
  );
  if (bucketNames.filter((name) => name === qualified.r2_buckets[0].bucket_name).length !== 1)
    fail("RETAINED_R2_INVENTORY_DRIFT");
  if (workerAbsent) {
    if (runtime.configuration.predecessorBaseline) fail("PREDECESSOR_WORKER_ABSENT");
    if (presentIntended.length !== 0) fail("WORKFLOW_NAME_COLLISION");
  } else if (
    runtime.configuration.predecessorBaseline &&
    journal.state === "PREPARED" &&
    journal.events.length === 0
  ) {
    if (JSON.stringify(presentIntended) !== JSON.stringify(intendedWorkflows))
      fail("PREDECESSOR_WORKFLOW_DRIFT");
    await verifyPredecessorBaseline(runtime, authority, context, qualified);
  } else {
    if (
      !["DISABLED_VERIFIED", "SAFE_DISABLED_CLEAN", "QUALIFIED_VERIFIED"].includes(journal.state) ||
      JSON.stringify(presentIntended) !== JSON.stringify(intendedWorkflows)
    )
      fail("EXISTING_WORKER_NOT_EXACT_OWNED");
    const transport =
      journal.state === "QUALIFIED_VERIFIED" ? "QUALIFIED_EXACT" : "DISABLED_UNQUALIFIED";
    const version = await readActiveVersion(
      runtime,
      authority,
      transport === "QUALIFIED_EXACT"
        ? runtime.configuration.qualifiedConfigPath
        : runtime.configuration.disabledConfigPath,
      transport,
      true,
      context,
      journal.introduced_secret_names,
    );
    if (version.versionId !== journal.active_version_id) fail("EXISTING_WORKER_VERSION_DRIFT");
  }
  return Object.freeze({
    workerAbsent,
    predecessorVerified:
      !workerAbsent &&
      runtime.configuration.predecessorBaseline !== undefined &&
      journal.state === "PREPARED" &&
      journal.events.length === 0,
  });
}

function normalizedVersionProjection(
  version,
  qualified,
  expectedTransport,
  requireR2,
  expectedSecretNames,
) {
  const expectedVars = Object.freeze({
    ...qualified.vars,
    VIDEOFORGE_GPU_TRANSPORT: expectedTransport,
  });
  const variables = new Map();
  const bindings = new Map();
  const secrets = [];
  const extras = [];
  const expectedBindingTypes = Object.freeze({
    ASSETS: "assets",
    CF_VERSION_METADATA: "version_metadata",
    HOSTED_PAIR_WORKFLOW: "workflow",
    PRIVATE_ARTIFACTS: "r2_bucket",
    VIDEO_WORKFLOW: "workflow",
  });
  const add = (map, name, value) => {
    const values = map.get(name) ?? [];
    values.push(value);
    map.set(name, values);
  };
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) return item.forEach(visit);
    if (item === version && item.vars && typeof item.vars === "object") {
      for (const [name, value] of Object.entries(item.vars)) {
        if (!Object.hasOwn(expectedVars, name) || typeof value !== "string")
          extras.push(`var:${name}`);
        else add(variables, name, value);
      }
    }
    const descriptorName = typeof item.name === "string" ? item.name : null;
    const descriptorType = typeof item.type === "string" ? item.type : null;
    if (descriptorName !== null && descriptorType === "plain_text") {
      const value = item.text ?? item.value;
      if (Object.hasOwn(expectedVars, descriptorName) && typeof value === "string")
        add(variables, descriptorName, value);
      else extras.push(`var:${item.name}`);
    } else if (descriptorName !== null && /secret/iu.test(descriptorType ?? "")) {
      if (SECRET_NAMES.includes(descriptorName)) secrets.push(descriptorName);
      else extras.push(`secret:${item.name}`);
    } else {
      const explicitBinding = typeof item.binding === "string";
      const bindingName = explicitBinding
        ? item.binding
        : descriptorType === null
          ? null
          : descriptorName;
      if (bindingName !== null) {
        if (
          !Object.hasOwn(expectedBindingTypes, bindingName) ||
          (descriptorType !== null && descriptorType !== expectedBindingTypes[bindingName])
        ) {
          extras.push(`binding:${bindingName}`);
        } else if (bindingName === "VIDEO_WORKFLOW" || bindingName === "HOSTED_PAIR_WORKFLOW") {
          add(bindings, bindingName, item.namespace ?? item.workflow_name ?? item.name);
        } else if (bindingName === "PRIVATE_ARTIFACTS") {
          add(bindings, bindingName, item.bucket_name ?? item.bucketName);
        } else if (bindingName === "ASSETS") {
          add(bindings, bindingName, "ASSETS");
        } else if (bindingName === "CF_VERSION_METADATA") {
          add(bindings, bindingName, "CF_VERSION_METADATA");
        }
      } else if (descriptorName !== null && descriptorType !== null) {
        extras.push(`binding:${bindingName}`);
      }
    }
    Object.values(item).forEach(visit);
  };
  visit(version);
  const exactOne = (map, name, expected) => {
    const values = map.get(name) ?? [];
    return values.length === 1 && values[0] === expected;
  };
  const observedSecrets = [...secrets].sort();
  if (
    Object.entries(expectedVars).some(([name, value]) => !exactOne(variables, name, value)) ||
    variables.size !== Object.keys(expectedVars).length ||
    !exactOne(bindings, "VIDEO_WORKFLOW", qualified.workflows[0].name) ||
    !exactOne(bindings, "HOSTED_PAIR_WORKFLOW", qualified.workflows[1].name) ||
    !exactOne(bindings, "ASSETS", "ASSETS") ||
    !exactOne(bindings, "CF_VERSION_METADATA", "CF_VERSION_METADATA") ||
    (requireR2 && !exactOne(bindings, "PRIVATE_ARTIFACTS", qualified.r2_buckets[0].bucket_name)) ||
    (!requireR2 && bindings.has("PRIVATE_ARTIFACTS")) ||
    bindings.size !== (requireR2 ? 5 : 4) ||
    extras.length !== 0 ||
    new Set(observedSecrets).size !== observedSecrets.length ||
    JSON.stringify(observedSecrets) !== JSON.stringify([...expectedSecretNames].sort())
  )
    fail("ACTIVE_VERSION_CLOSED_WORLD_DRIFT");
  return Object.freeze({
    vars: Object.fromEntries([...variables].sort(([left], [right]) => left.localeCompare(right))),
    bindings: Object.fromEntries(
      [...bindings].sort(([left], [right]) => left.localeCompare(right)),
    ),
    secret_names: observedSecrets,
  });
}

async function readActiveVersion(
  runtime,
  authority,
  configPath,
  expectedTransport,
  requireR2,
  context,
  expectedSecretNames = [],
) {
  const status = await child(
    runtime,
    authority,
    [
      "deployments",
      "status",
      "--json",
      "--name",
      runtime.configuration.workerName,
      "--config",
      configPath,
    ],
    "DEPLOYMENT_STATUS",
    { context },
  );
  const versionId = extractSingleActiveVersion(status);
  if (!UUID.test(versionId)) fail("ACTIVE_VERSION_ID_INVALID");
  const raw = await child(
    runtime,
    authority,
    [
      "versions",
      "view",
      versionId,
      "--json",
      "--name",
      runtime.configuration.workerName,
      "--config",
      configPath,
    ],
    "VERSION_READBACK",
    { context },
  );
  const version = parseJson(raw, "VERSION_READBACK_JSON_INVALID");
  const qualified = qualifiedConfiguration(runtime.configuration, authority).value;
  const projection = normalizedVersionProjection(
    version,
    qualified,
    expectedTransport,
    requireR2,
    expectedSecretNames,
  );
  return Object.freeze({
    versionId,
    versionIdSha256: sha256(versionId),
    versionReadbackSha256: sha256(canonical(version)),
    versionConfigProjectionSha256: sha256(canonical(projection)),
  });
}

async function readRoute(
  runtime,
  authority,
  versionId,
  expectedTransport,
  context,
  allowMissingConfiguration = false,
  expectedSourceCommit = authority.source_commit,
) {
  const qualified = qualifiedConfiguration(runtime.configuration, authority).value;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const signal = context?.cancellationSignal
    ? AbortSignal.any([context.cancellationSignal, controller.signal])
    : controller.signal;
  let response;
  try {
    response = await runtime.fetchImpl(`${qualified.vars.VIDEOFORGE_PUBLIC_ORIGIN}${STATUS_PATH}`, {
      method: "GET",
      redirect: "error",
      signal,
    });
  } catch {
    fail("ROUTE_TRANSPORT_FAILED");
  } finally {
    clearTimeout(timeout);
  }
  let text;
  try {
    text = await response.text();
  } catch {
    fail("ROUTE_BODY_FAILED");
  }
  if (Buffer.byteLength(text) === 0 || Buffer.byteLength(text) > 1_048_576)
    fail("ROUTE_BODY_INVALID");
  const body = parseJson(text, "ROUTE_JSON_INVALID");
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") fail("ROUTE_CONTENT_TYPE_DRIFT");
  if (response.headers.get(VERSION_HEADER) !== versionId) fail("ROUTE_VERSION_HEADER_DRIFT");
  if (
    allowMissingConfiguration &&
    expectedTransport === "DISABLED_UNQUALIFIED" &&
    response.status === 503
  ) {
    if (
      response.headers.get("cache-control") !== "no-store" ||
      response.headers.get("x-videoforge-runtime") !== "hosted-v2-06" ||
      !exactKeys(body, ["error"]) ||
      !exactKeys(body.error, ["code", "retryable"]) ||
      body.error.code !== "HOSTED_CONFIGURATION_INVALID" ||
      body.error.retryable !== false
    )
      fail("ROUTE_MISSING_CONFIGURATION_DRIFT");
  } else {
    if (response.status !== 200) fail("ROUTE_HTTP_STATUS_DRIFT");
    if (body?.schema_version !== "videoforge-hosted-status/v1") fail("ROUTE_SCHEMA_DRIFT");
    if (body?.commit !== expectedSourceCommit) fail("ROUTE_SOURCE_DRIFT");
    if (body?.environment !== "production") fail("ROUTE_ENVIRONMENT_DRIFT");
    if (body?.gpu_transport !== expectedTransport) fail("ROUTE_TRANSPORT_DRIFT");
  }
  return Object.freeze({
    bodySha256: sha256(text),
    headerSha256: sha256(versionId),
    status: response.status,
  });
}

async function exactSecretNames(runtime, authority, context) {
  const raw = await child(
    runtime,
    authority,
    ["secret", "list", "--format", "json", "--config", runtime.configuration.disabledConfigPath],
    "SECRET_LIST",
    { context },
  );
  const value = parseJson(raw, "SECRET_LIST_JSON_INVALID");
  if (!Array.isArray(value) || value.some((item) => !exactKeys(item, ["name", "type"])))
    fail("SECRET_LIST_SHAPE_DRIFT");
  const names = value.map(({ name }) => name).sort();
  if (new Set(names).size !== names.length) fail("SECRET_LIST_DUPLICATE");
  return names;
}

async function verifyDisabled(
  runtime,
  authority,
  context,
  journal,
  expectedSecretNames = journal.introduced_secret_names,
) {
  const version = await readActiveVersion(
    runtime,
    authority,
    runtime.configuration.disabledConfigPath,
    "DISABLED_UNQUALIFIED",
    true,
    context,
    expectedSecretNames,
  );
  await readRoute(
    runtime,
    authority,
    version.versionId,
    "DISABLED_UNQUALIFIED",
    context,
    expectedSecretNames.length < SECRET_NAMES.length,
  );
  journal.state = "DISABLED_VERIFIED";
  journal.active_version_id = version.versionId;
  saveJournal(journal, runtime.configuration);
  return version;
}

async function verifyCommittedSecretPut(runtime, authority, context, journal) {
  const retryable = new Set([
    "V2_09_CLOUDFLARE_PRODUCTION_ACTIVE_VERSION_CLOSED_WORLD_DRIFT",
    "V2_09_CLOUDFLARE_PRODUCTION_ROUTE_READBACK_DRIFT",
    "V2_09_CLOUDFLARE_PRODUCTION_ROUTE_VERSION_HEADER_DRIFT",
  ]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assertCurrentAuthority(authority, runtime.configuration, runtime.now);
    if (context?.cancellationSignal?.aborted) fail("SECRET_READBACK_CANCELLED");
    try {
      return await verifyDisabled(runtime, authority, context, journal);
    } catch (error) {
      if (attempt === 2 || !retryable.has(error?.message)) throw error;
      try {
        await waitForPropagation(2000, undefined, { signal: context?.cancellationSignal });
      } catch {
        fail("SECRET_READBACK_CANCELLED");
      }
    }
  }
}

function copyImmutableTree(source, destination) {
  const sourceStat = lstatSync(source);
  if (sourceStat.isSymbolicLink()) fail("UPLOAD_ARTIFACT_SYMLINK");
  if (sourceStat.isFile()) {
    copyFileSync(source, destination, fsConstants.COPYFILE_EXCL);
    chmodSync(destination, 0o400);
    return;
  }
  if (!sourceStat.isDirectory()) fail("UPLOAD_ARTIFACT_ENTRY_INVALID");
  mkdirSync(destination, { mode: 0o700 });
  for (const name of readdirSync(source).sort((left, right) => left.localeCompare(right)))
    copyImmutableTree(resolve(source, name), resolve(destination, name));
  chmodSync(destination, 0o500);
}

function makeTreeRemovable(path) {
  const stat = lstatSync(path);
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) makeTreeRemovable(resolve(path, name));
  } else chmodSync(path, 0o600);
}

export function snapshotV209UploadArtifact(
  qualifiedConfigBytes,
  { mainPath = ACTIVATED_MAIN_PATH, assetsSourcePath = ACTIVATED_ASSETS_PATH } = {},
) {
  if (!Buffer.isBuffer(qualifiedConfigBytes)) fail("UPLOAD_CONFIG_BYTES_INVALID");
  if (![mainPath, assetsSourcePath].every((path) => typeof path === "string" && isAbsolute(path)))
    fail("UPLOAD_ARTIFACT_SOURCE_PATH_INVALID");
  // Wrangler embeds input paths in its generated bundle comments. Use an exclusive path derived
  // from the already authority-bound config bytes so the provider-free dry-run hash exactly
  // matches the later upload bundle while any stale or concurrent artifact fails closed.
  const directory = resolve(
    tmpdir(),
    `videoforge-v209-cloudflare-upload-${sha256(qualifiedConfigBytes).slice(7)}`,
  );
  const moduleDirectory = resolve(directory, "worker");
  const modulePath = resolve(moduleDirectory, basename(mainPath));
  const assetsPath = resolve(directory, "assets");
  const configPath = resolve(directory, "qualified-config.json");
  let directoryCreated = false;
  try {
    mkdirSync(directory, { mode: 0o700 });
    directoryCreated = true;
    // Preserve the complete Vite Worker module graph. The entrypoint imports generated sibling
    // chunks, so copying only index.js produces a Cloudflare validation error before versioning.
    copyImmutableTree(dirname(mainPath), moduleDirectory);
    copyImmutableTree(assetsSourcePath, assetsPath);
    writeFileSync(configPath, qualifiedConfigBytes, { flag: "wx", mode: 0o400 });
    chmodSync(directory, 0o500);
  } catch (error) {
    if (directoryCreated) {
      makeTreeRemovable(directory);
      rmSync(directory, { recursive: true, force: true });
    }
    throw error;
  }
  return Object.freeze({
    assetsPath,
    configPath,
    modulePath,
    cleanup() {
      makeTreeRemovable(directory);
      rmSync(directory, { recursive: true, force: true });
    },
  });
}

function artifactDeployArgs(runtime, context, artifact, { dryRunDirectory } = {}) {
  return [
    "deploy",
    artifact.modulePath,
    "--assets",
    artifact.assetsPath,
    "--config",
    artifact.configPath,
    "--message",
    `videoforge-v2-09-qualified:${context.authority.source_commit}`,
    "--x-auto-create",
    "false",
    "--strict",
    "--no-upload-source-maps",
    ...(dryRunDirectory === undefined ? [] : ["--dry-run", "--outdir", dryRunDirectory]),
  ];
}

function assertUploadArtifact(artifact, authority) {
  if (
    artifact === null ||
    typeof artifact !== "object" ||
    typeof artifact.cleanup !== "function" ||
    ![artifact.assetsPath, artifact.configPath, artifact.modulePath].every(
      (path) => typeof path === "string" && isAbsolute(path),
    ) ||
    new Set([artifact.assetsPath, artifact.configPath, artifact.modulePath]).size !== 3
  )
    fail("UPLOAD_ARTIFACT_INVALID");
  const moduleStat = lstatSync(artifact.modulePath);
  const assetsStat = lstatSync(artifact.assetsPath);
  const configStat = lstatSync(artifact.configPath);
  if (
    !moduleStat.isFile() ||
    moduleStat.isSymbolicLink() ||
    !assetsStat.isDirectory() ||
    assetsStat.isSymbolicLink() ||
    !configStat.isFile() ||
    configStat.isSymbolicLink() ||
    (moduleStat.mode & 0o222) !== 0 ||
    (assetsStat.mode & 0o222) !== 0 ||
    (configStat.mode & 0o222) !== 0 ||
    sha256(readFileSync(artifact.configPath)) !== authority.production.config_sha256
  )
    fail("UPLOAD_ARTIFACT_NOT_IMMUTABLE");
  return artifact;
}

async function verifyQualifiedBundle(runtime, authority, context, artifact) {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v209-cloudflare-dry-"));
  try {
    await child(
      runtime,
      authority,
      artifactDeployArgs(runtime, context, artifact, { dryRunDirectory: directory }),
      "BUNDLE_DRY_RUN",
      { context },
    );
    const observed = hashV209DryOutputBundle(directory, {
      workerName: runtime.configuration.workerName,
    });
    if (observed !== authority.production.worker_bundle_sha256) fail("WORKER_BUNDLE_HASH_DRIFT");
    return observed;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function possiblyIntroducedSecrets(journal) {
  const names = new Set(journal.introduced_secret_names);
  for (const event of journal.events) {
    if (event.kind === "SECRET_PUT" && typeof event.name === "string") names.add(event.name);
    if (event.kind === "SECRET_BULK_PUT") for (const name of SECRET_NAMES) names.add(name);
  }
  return [...names].filter((name) => SECRET_NAMES.includes(name)).sort();
}

async function reconcileFailure(runtime, authority, context, journal) {
  if (journal.state === "SAFE_DISABLED_CLEAN") {
    if (
      journal.introduced_secret_names.length !== 0 ||
      (await exactSecretNames(runtime, authority, context)).length !== 0
    )
      fail("SAFE_CLEAN_SECRET_DRIFT");
    const versionId = journal.active_version_id;
    const version = await readActiveVersion(
      runtime,
      authority,
      runtime.configuration.disabledConfigPath,
      "DISABLED_UNQUALIFIED",
      true,
      context,
      [],
    );
    if (version.versionId !== versionId) fail("SAFE_CLEAN_VERSION_DRIFT");
    await readRoute(runtime, authority, versionId, "DISABLED_UNQUALIFIED", context, true);
    journal.state = "SAFE_DISABLED_CLEAN";
    saveJournal(journal, runtime.configuration);
    return Object.freeze({
      schema_version: "videoforge.v2-09-cloudflare-safety-reconciliation/v1",
      worker: runtime.configuration.workerName,
      gpu_transport: "DISABLED_UNQUALIFIED",
      secret_count: 0,
      retained_r2_deleted: false,
      safety_verified: true,
    });
  }
  journal.state = "RECONCILING_DISABLED";
  saveJournal(journal, runtime.configuration);
  materializeDisabled(runtime.configuration, authority);
  await mutate(
    runtime,
    authority,
    journal,
    context,
    "DISABLED_RECONCILE_DEPLOY",
    [
      "deploy",
      "--config",
      runtime.configuration.disabledConfigPath,
      "--message",
      `videoforge-v2-09-disabled-reconcile:${authority.source_commit}`,
      "--x-auto-create",
      "false",
    ],
    "DISABLED_RECONCILE_DEPLOY",
    { cleanup: context.cleanupOnly === true },
  );
  const observedSecretNames = await exactSecretNames(runtime, authority, context);
  const attributableNames = possiblyIntroducedSecrets(journal);
  if (observedSecretNames.some((name) => !attributableNames.includes(name)))
    fail("CLEANUP_SECRET_ATTRIBUTION_DRIFT");
  await verifyDisabled(runtime, authority, context, journal, observedSecretNames);
  for (const name of attributableNames.reverse()) {
    const priorDelete = journal.events.some(
      (event) =>
        event.kind === "SECRET_DELETE" &&
        event.name === name &&
        ["INTENT", "COMMITTED", "UNKNOWN"].includes(event.status),
    );
    if (priorDelete && observedSecretNames.includes(name)) fail("SECRET_DELETE_REPLAY_FORBIDDEN");
    if (!observedSecretNames.includes(name)) continue;
    await mutate(
      runtime,
      authority,
      journal,
      context,
      "SECRET_DELETE",
      ["secret", "delete", name, "--config", runtime.configuration.disabledConfigPath],
      "SECRET_DELETE",
      { cleanup: context.cleanupOnly === true, name },
    );
  }
  journal.introduced_secret_names = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (context.cleanupOnly === true)
      assertCleanupAuthority(authority, runtime.configuration, runtime.now);
    else assertCurrentAuthority(authority, runtime.configuration, runtime.now);
    if (context?.cancellationSignal?.aborted) fail("SECRET_READBACK_CANCELLED");
    if ((await exactSecretNames(runtime, authority, context)).length === 0) break;
    if (attempt === 2) fail("RECONCILIATION_SECRET_SET_NOT_EMPTY");
    try {
      await waitForPropagation(2000, undefined, { signal: context?.cancellationSignal });
    } catch {
      fail("SECRET_READBACK_CANCELLED");
    }
  }
  await verifyDisabled(runtime, authority, context, journal);
  journal.state = "SAFE_DISABLED_CLEAN";
  saveJournal(journal, runtime.configuration);
  return Object.freeze({
    schema_version: "videoforge.v2-09-cloudflare-safety-reconciliation/v1",
    worker: runtime.configuration.workerName,
    gpu_transport: "DISABLED_UNQUALIFIED",
    secret_count: 0,
    retained_r2_deleted: false,
    safety_verified: true,
  });
}

async function guardedRun(runtime, context, operationId, implementation) {
  assertOperationContext(context, operationId);
  assertCurrentAuthority(context.authority, runtime.configuration, runtime.now);
  const journal = loadJournal(context.authority, runtime.configuration);
  try {
    return await implementation(journal);
  } catch (error) {
    journal.failure ??= { operation_code: safeFailureCode(error), cleanup_code: null };
    try {
      saveJournal(journal, runtime.configuration);
    } catch {
      /* Diagnostic persistence must not block cleanup. */
    }
    if (journal.events.some(({ status }) => status === "INTENT")) {
      try {
        await reconcileFailure(runtime, context.authority, context, journal);
      } catch (cleanupError) {
        journal.failure.cleanup_code = safeFailureCode(cleanupError);
        journal.state = "MANUAL_RECONCILIATION_REQUIRED";
        saveJournal(journal, runtime.configuration);
        fail("FAILURE_RECONCILIATION_REQUIRED");
      }
    }
    throw error;
  }
}

async function deployDisabled(runtime, context) {
  return guardedRun(runtime, context, "deploy-cloudflare-disabled-bootstrap", async (journal) => {
    const { disabledSha256 } = materializeDisabled(runtime.configuration, context.authority);
    const inventory = await exactPreMutationInventory(runtime, context.authority, context, journal);
    if (!inventory.workerAbsent && !inventory.predecessorVerified)
      fail("EXACT_OWNED_WORKER_REQUIRES_CLEANUP_ONLY");
    await mutate(
      runtime,
      context.authority,
      journal,
      context,
      "BOOTSTRAP_DEPLOY",
      [
        "deploy",
        "--config",
        runtime.configuration.bootstrapConfigPath,
        "--message",
        `videoforge-v2-09-workflow-bootstrap:${context.authority.source_commit}`,
        "--x-auto-create",
        "true",
      ],
      "BOOTSTRAP_DEPLOY",
    );
    await readActiveVersion(
      runtime,
      context.authority,
      runtime.configuration.bootstrapConfigPath,
      "DISABLED_UNQUALIFIED",
      false,
      context,
      [],
    );
    await mutate(
      runtime,
      context.authority,
      journal,
      context,
      "FULL_DISABLED_DEPLOY",
      [
        "deploy",
        "--config",
        runtime.configuration.disabledConfigPath,
        "--message",
        `videoforge-v2-09-disabled:${context.authority.source_commit}`,
        "--x-auto-create",
        "false",
      ],
      "FULL_DISABLED_DEPLOY",
    );
    await verifyDisabled(runtime, context.authority, context, journal);
    if ((await exactSecretNames(runtime, context.authority, context)).length !== 0)
      fail("PREEXISTING_SECRET_SET_NOT_EMPTY");
    return {
      schema_version: "videoforge.v2-09-disabled-bootstrap-result/v1",
      operation_id: context.operationId,
      worker: runtime.configuration.workerName,
      config_sha256: disabledSha256,
      gpu_transport: "DISABLED_UNQUALIFIED",
      bootstrap_deploy_count: 1,
      full_disabled_deploy_count: 1,
      deploy_count: 2,
    };
  });
}

async function uploadSecrets(runtime, context) {
  return guardedRun(runtime, context, "upload-cloudflare-production-secrets", async (journal) => {
    materializeDisabled(runtime.configuration, context.authority);
    const allowlistSha256 = sha256(canonical([...SECRET_NAMES].sort()));
    const suppliedSecretSha256s = context.secretInputSha256s;
    if (
      context.authority.production.secret_allowlist_sha256 !== allowlistSha256 ||
      canonical(suppliedSecretSha256s) !== canonical(runtime.secretInputSha256s) ||
      (await exactSecretNames(runtime, context.authority, context)).length !== 0
    )
      fail("SECRET_AUTHORITY_OR_BASELINE_DRIFT");
    if (journal.events.some((event) => event.kind === "SECRET_BULK_PUT"))
      fail("SECRET_BULK_REPLAY_FORBIDDEN");
    const qualified = qualifiedConfiguration(runtime.configuration, context.authority).value;
    const beforeDispatch = () => {
      assertCurrentAuthority(context.authority, runtime.configuration, runtime.now);
      if (context.cancellationSignal?.aborted) fail("SECRET_READBACK_CANCELLED");
    };
    beforeDispatch();
    // Intent attributes every requested key before one non-retryable PATCH. A
    // lost response may have applied any subset; cleanup reads the actual set.
    record(journal, runtime.configuration, {
      status: "INTENT",
      kind: "SECRET_BULK_PUT",
      operation_id: context.operationId,
      observed_at: readClock(runtime.now).toISOString(),
    });
    try {
      const result = await runtime.secretBulk({
        accountId: qualified.account_id,
        workerName: runtime.configuration.workerName,
        oauthConfigPath: runtime.configuration.oauthConfigPath,
        environment: runtime.configuration.environment,
        expectedOauthScopes: runtime.configuration.expectedOauthScopes,
        secretInputs: runtime.secretInputs,
        cancellationSignal: context.cancellationSignal,
        beforeDispatch,
        expiresAt: context.authority.expires_at,
      });
      if (result?.secret_count !== SECRET_NAMES.length) fail("SECRET_BULK_FAILED");
      record(journal, runtime.configuration, {
        status: "COMMITTED",
        kind: "SECRET_BULK_PUT",
        operation_id: context.operationId,
        observed_at: readClock(runtime.now).toISOString(),
      });
    } catch (error) {
      record(journal, runtime.configuration, {
        status: "UNKNOWN",
        kind: "SECRET_BULK_PUT",
        operation_id: context.operationId,
        observed_at: readClock(runtime.now).toISOString(),
      });
      if (FAILURE_CODES.has(error?.message)) throw error;
      fail("SECRET_BULK_FAILED");
    }
    journal.introduced_secret_names = [...SECRET_NAMES];
    saveJournal(journal, runtime.configuration);
    await verifyCommittedSecretPut(runtime, context.authority, context, journal);
    if (
      JSON.stringify(await exactSecretNames(runtime, context.authority, context)) !==
      JSON.stringify([...SECRET_NAMES].sort())
    )
      fail("SECRET_CLOSED_WORLD_DRIFT");
    await mutate(
      runtime,
      context.authority,
      journal,
      context,
      "DISABLED_WITH_SECRETS_DEPLOY",
      [
        "deploy",
        "--config",
        runtime.configuration.disabledConfigPath,
        "--message",
        `videoforge-v2-09-disabled-with-secrets:${context.authority.source_commit}`,
        "--x-auto-create",
        "false",
      ],
      "DISABLED_WITH_SECRETS_DEPLOY",
    );
    await verifyDisabled(runtime, context.authority, context, journal);
    if (
      JSON.stringify(await exactSecretNames(runtime, context.authority, context)) !==
      JSON.stringify([...SECRET_NAMES].sort())
    )
      fail("SECRET_FINAL_CLOSED_WORLD_DRIFT");
    return {
      schema_version: "videoforge.v2-09-secret-upload-result/v1",
      operation_id: context.operationId,
      worker: runtime.configuration.workerName,
      secret_allowlist_sha256: allowlistSha256,
      secret_count: SECRET_NAMES.length,
      secret_put_count: SECRET_NAMES.length,
      deploy_count: 1,
      mutation_count: 2,
      transaction_count: 1,
    };
  });
}

async function deployQualified(runtime, context) {
  return guardedRun(runtime, context, "deploy-cloudflare-qualified-production", async (journal) => {
    qualifiedConfiguration(runtime.configuration, context.authority);
    const artifact = assertUploadArtifact(
      runtime.snapshotUploadArtifact(
        qualifiedConfiguration(runtime.configuration, context.authority).bytes,
      ),
      context.authority,
    );
    try {
      const bundleSha256 = await verifyQualifiedBundle(
        runtime,
        context.authority,
        context,
        artifact,
      );
      await mutate(
        runtime,
        context.authority,
        journal,
        context,
        "QUALIFIED_DEPLOY",
        artifactDeployArgs(runtime, context, artifact),
        "QUALIFIED_DEPLOY",
      );
      const version = await readActiveVersion(
        runtime,
        context.authority,
        runtime.configuration.qualifiedConfigPath,
        "QUALIFIED_EXACT",
        true,
        context,
        SECRET_NAMES,
      );
      await readRoute(
        runtime,
        context.authority,
        version.versionId,
        "DISABLED_UNQUALIFIED",
        context,
      );
      journal.state = "QUALIFIED_VERIFIED";
      journal.active_version_id = version.versionId;
      journal.worker_bundle_sha256 = bundleSha256;
      saveJournal(journal, runtime.configuration);
      return {
        schema_version: "videoforge.v2-09-qualified-deploy-result/v1",
        operation_id: context.operationId,
        worker: runtime.configuration.workerName,
        config_sha256: context.authority.production.config_sha256,
        worker_bundle_sha256: bundleSha256,
        deployment_id_sha256: version.versionIdSha256,
        deploy_count: 1,
      };
    } finally {
      artifact.cleanup();
    }
  });
}

async function readbackQualified(runtime, context) {
  if (typeof context?.activationImported !== "boolean") fail("ACTIVATION_PHASE_REQUIRED");
  assertOperationContext(context, "readback-qualified-production");
  assertCurrentAuthority(context.authority, runtime.configuration, runtime.now);
  qualifiedConfiguration(runtime.configuration, context.authority);
  const journal = loadJournal(context.authority, runtime.configuration);
  if (
    journal.state !== "QUALIFIED_VERIFIED" ||
    !UUID.test(journal.active_version_id ?? "") ||
    journal.worker_bundle_sha256 !== context.authority.production.worker_bundle_sha256
  )
    fail("QUALIFIED_JOURNAL_NOT_VERIFIED");
  const version = await readActiveVersion(
    runtime,
    context.authority,
    runtime.configuration.qualifiedConfigPath,
    "QUALIFIED_EXACT",
    true,
    context,
    SECRET_NAMES,
  );
  if (version.versionId !== journal.active_version_id) fail("QUALIFIED_VERSION_CHANGED");
  const effectiveTransport =
    context.activationImported === true ? "QUALIFIED_EXACT" : "DISABLED_UNQUALIFIED";
  await readRoute(runtime, context.authority, version.versionId, effectiveTransport, context);
  return {
    schema_version: "videoforge.v2-09-qualified-readback-result/v1",
    operation_id: context.operationId,
    worker: runtime.configuration.workerName,
    config_sha256: context.authority.production.config_sha256,
    worker_bundle_sha256: context.authority.production.worker_bundle_sha256,
    gpu_transport: "QUALIFIED_EXACT",
    effective_gpu_transport: effectiveTransport,
    exact_pair_bound: true,
    deployment_id_sha256: version.versionIdSha256,
  };
}

export function planV209CloudflareProduction() {
  return Object.freeze({
    schema_version: "videoforge.v2-09-cloudflare-production-plan/v1",
    remote_mutations: 0,
    provider_calls: 0,
    retained_r2_mutation: false,
    state: "DRY_RUN_NO_ACTION",
  });
}

function functionSha256(value, code) {
  if (typeof value !== "function") fail(code);
  return sha256(Function.prototype.toString.call(value));
}

function sanitizedConfigurationIdentity(configuration, secretInputSha256s) {
  return sha256(
    canonical({
      schema_version: "videoforge.v2-09-cloudflare-sanitized-configuration/v1",
      root_sha256: sha256(configuration.root),
      source_commit: configuration.sourceCommit,
      worker_name: configuration.workerName,
      qualified_config_path_sha256: sha256(configuration.qualifiedConfigPath),
      predecessor_baseline_sha256: sha256(canonical(configuration.predecessorBaseline ?? null)),
      disabled_config_path_sha256: sha256(configuration.disabledConfigPath),
      bootstrap_config_path_sha256: sha256(configuration.bootstrapConfigPath),
      journal_path_sha256: sha256(configuration.journalPath),
      oauth_credential_path_sha256: sha256(configuration.oauthConfigPath),
      oauth_scopes_sha256: sha256(canonical(configuration.expectedOauthScopes)),
      environment_sha256: sha256(canonical(configuration.environment)),
      secret_path_sha256s: Object.fromEntries(
        SECRET_NAMES.map((name) => [name, sha256(configuration.secretFiles[name])]),
      ),
      secret_input_sha256s: secretInputSha256s,
    }),
  );
}

function createProductionRuntime(inputConfiguration, dependencies = {}) {
  const configuration = assertConfiguration(inputConfiguration);
  const secretInputs = sealSecretInputs(configuration);
  const secretInputSha256s = Object.freeze(
    Object.fromEntries(SECRET_NAMES.map((name) => [name, secretInputs[name].sha256])),
  );
  const injectedNames = Object.keys(dependencies).filter((name) => name !== "testOnly");
  if (injectedNames.length > 0 && dependencies.testOnly !== true)
    fail("PRODUCTION_DEPENDENCY_INJECTION_FORBIDDEN");
  const runtime = Object.freeze({
    configuration,
    fetchImpl: dependencies.fetchImpl ?? fetch,
    now: dependencies.now ?? (() => new Date()),
    oauthApiResponse: dependencies.oauthApiResponse ?? cloudflareOAuthApiResponse,
    oauthSpawn: dependencies.oauthSpawn,
    runChild: dependencies.runChild ?? runCancellableChildProcess,
    secretBulk: dependencies.secretBulk ?? executeV209SecretBulk,
    secretInputs,
    secretInputSha256s,
    snapshotUploadArtifact: dependencies.snapshotUploadArtifact ?? snapshotV209UploadArtifact,
  });
  if (
    typeof runtime.fetchImpl !== "function" ||
    typeof runtime.now !== "function" ||
    typeof runtime.oauthApiResponse !== "function" ||
    typeof runtime.runChild !== "function" ||
    typeof runtime.secretBulk !== "function" ||
    typeof runtime.snapshotUploadArtifact !== "function" ||
    (runtime.oauthSpawn !== undefined && typeof runtime.oauthSpawn !== "function")
  )
    fail("DEPENDENCY_INVALID");
  return runtime;
}

export function createV209CloudflareProductionOperator(inputConfiguration, dependencies = {}) {
  const runtime = createProductionRuntime(inputConfiguration, dependencies);
  const { configuration, secretInputSha256s } = runtime;
  const source = readFileSync(SOURCE_PATH);
  const identityBase = Object.freeze({
    schema_version: PORT_SCHEMA,
    module_sha256: sha256(source),
    imported_dependency_sha256s: Object.fromEntries(
      IMPORTED_DEPENDENCY_PATHS.map((path) => [path, sha256(readFileSync(resolve(ROOT, path)))]),
    ),
    configuration_identity_sha256: sanitizedConfigurationIdentity(
      configuration,
      secretInputSha256s,
    ),
    composed_dependency_sha256s: {
      fetchImpl: functionSha256(runtime.fetchImpl, "FETCH_DEPENDENCY_INVALID"),
      now: functionSha256(runtime.now, "CLOCK_DEPENDENCY_INVALID"),
      oauthApiResponse: functionSha256(runtime.oauthApiResponse, "OAUTH_DEPENDENCY_INVALID"),
      oauthSpawn:
        runtime.oauthSpawn === undefined
          ? null
          : functionSha256(runtime.oauthSpawn, "OAUTH_SPAWN_DEPENDENCY_INVALID"),
      runChild: functionSha256(runtime.runChild, "CHILD_DEPENDENCY_INVALID"),
      secretBulk: functionSha256(runtime.secretBulk, "SECRET_BULK_DEPENDENCY_INVALID"),
      snapshotUploadArtifact: functionSha256(
        runtime.snapshotUploadArtifact,
        "SNAPSHOT_DEPENDENCY_INVALID",
      ),
    },
  });
  const descriptor = (name, run) =>
    Object.freeze({
      source_sha256: sha256(
        canonical({
          ...identityBase,
          capability: name,
          capability_function_sha256: functionSha256(run, "CAPABILITY_INVALID"),
        }),
      ),
      run: (context) => run(runtime, context),
    });
  return Object.freeze({
    deployCloudflareDisabled: descriptor("deployCloudflareDisabled", deployDisabled),
    uploadCloudflareSecrets: Object.freeze({
      ...descriptor("uploadCloudflareSecrets", uploadSecrets),
      secret_input_sha256s: secretInputSha256s,
    }),
    deployCloudflareQualified: descriptor("deployCloudflareQualified", deployQualified),
    readbackCloudflareQualified: descriptor("readbackCloudflareQualified", readbackQualified),
    reconcileCloudflareSafety: descriptor(
      "reconcileCloudflareSafety",
      async (runtimeValue, context) => {
        if (context?.cleanupOnly !== true) fail("RECONCILIATION_CONTEXT_INVALID");
        if (
          isPreRenderCleanupAuthority(
            context.authority,
            runtimeValue.configuration,
            runtimeValue.now,
          )
        ) {
          // No rendered identities exist yet. Require the exact staged shape and
          // actual journal absence; do not fabricate hashes or write a partial journal.
          let journalAbsent = false;
          try {
            lstatSync(runtimeValue.configuration.journalPath);
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
            journalAbsent = true;
          }
          if (!journalAbsent) fail("PRERENDER_CLEANUP_JOURNAL_PRESENT");
          return Object.freeze({
            schema_version: "videoforge.v2-09-cloudflare-safety-reconciliation/v1",
            worker: runtimeValue.configuration.workerName,
            gpu_transport: "UNTOUCHED_NO_MUTATIONS",
            secret_count: null,
            retained_r2_deleted: false,
            safety_verified: true,
          });
        }
        assertCleanupAuthority(context.authority, runtimeValue.configuration, runtimeValue.now);
        const journal = loadJournal(context.authority, runtimeValue.configuration);
        if (
          canonical(
            Object.fromEntries(Object.entries(journal).filter(([key]) => key !== "failure")),
          ) === canonical(newJournal(context.authority, runtimeValue.configuration))
        ) {
          // A render failure can precede the qualified file and every Cloudflare
          // mutation. Prove this authority's untouched journal without inventing
          // a deployed transport or attempting a cleanup deployment.
          return Object.freeze({
            schema_version: "videoforge.v2-09-cloudflare-safety-reconciliation/v1",
            worker: runtimeValue.configuration.workerName,
            gpu_transport: "UNTOUCHED_NO_MUTATIONS",
            secret_count: null,
            retained_r2_deleted: false,
            safety_verified: true,
          });
        }
        return reconcileFailure(runtimeValue, context.authority, context, journal);
      },
    ),
  });
}

// Narrow built-in replacement capabilities; no normal operator journal adoption or secret writes.
export function createV209CloudflareReplacementCapabilities(configuration, dependencies = {}) {
  const runtime = createProductionRuntime(configuration, dependencies);
  const context = (authority) => ({
    authority,
    operationId: "deploy-cloudflare-qualified-production",
  });
  const read = async (authority, transport, sourceRuntime = runtime) => {
    const ctx = context(authority);
    const names = await exactSecretNames(
      {
        ...sourceRuntime,
        configuration: {
          ...sourceRuntime.configuration,
          disabledConfigPath: sourceRuntime.configuration.qualifiedConfigPath,
        },
      },
      authority,
      ctx,
    );
    if (canonical(names) !== canonical([...SECRET_NAMES].sort())) fail("SECRET_LIST_DRIFT");
    return readActiveVersion(
      sourceRuntime,
      authority,
      sourceRuntime.configuration.qualifiedConfigPath,
      transport,
      true,
      ctx,
      SECRET_NAMES,
    );
  };
  return Object.freeze({
    now: () => readClock(runtime.now),
    assertAuthority: (authority) =>
      assertCurrentAuthority(authority, runtime.configuration, runtime.now),
    assertCleanupAuthority: (authority) =>
      assertCleanupAuthority(authority, runtime.configuration, runtime.now),
    async predecessor(authority, predecessor) {
      const artifactRootPath = predecessor.artifactRootPath;
      if (
        predecessor.sourceCommit !== authority.source_commit &&
        (typeof artifactRootPath !== "string" || !isAbsolute(artifactRootPath))
      )
        fail("PREDECESSOR_ARTIFACT_ROOT_INVALID");
      if (artifactRootPath !== undefined) validatePredecessorArtifactTree(artifactRootPath);
      const oldAuthority = {
        ...authority,
        source_commit: predecessor.sourceCommit,
        production: {
          ...authority.production,
          config_sha256: predecessor.qualifiedConfigSha256,
          worker_bundle_sha256: predecessor.workerBundleSha256,
        },
      };
      const oldRuntime = {
        ...runtime,
        configuration: {
          ...runtime.configuration,
          sourceCommit: predecessor.sourceCommit,
          qualifiedConfigPath: predecessor.qualifiedConfigPath,
          ...(artifactRootPath === undefined
            ? {}
            : { [PREDECESSOR_ARTIFACT_ROOT]: artifactRootPath }),
        },
      };
      const version = await read(oldAuthority, "QUALIFIED_EXACT", oldRuntime);
      if (version.versionId !== predecessor.versionId) fail("PREDECESSOR_VERSION_DRIFT");
      // An aged activation is precisely why this replacement may be needed. Only these two
      // explicit effective states are permitted; native config remains exact QUALIFIED_EXACT.
      try {
        await readRoute(
          oldRuntime,
          oldAuthority,
          version.versionId,
          "QUALIFIED_EXACT",
          context(oldAuthority),
        );
      } catch (error) {
        if (error?.message !== "V2_09_CLOUDFLARE_PRODUCTION_ROUTE_TRANSPORT_DRIFT") throw error;
        await readRoute(
          oldRuntime,
          oldAuthority,
          version.versionId,
          "DISABLED_UNQUALIFIED",
          context(oldAuthority),
        );
      }
      return version;
    },
    async prepare(authority) {
      const artifact = assertUploadArtifact(
        runtime.snapshotUploadArtifact(
          qualifiedConfiguration(runtime.configuration, authority).bytes,
        ),
        authority,
      );
      try {
        await verifyQualifiedBundle(runtime, authority, context(authority), artifact);
        return artifact;
      } catch (error) {
        artifact.cleanup();
        throw error;
      }
    },
    async deploy(authority, artifact) {
      await child(
        runtime,
        authority,
        artifactDeployArgs(runtime, context(authority), artifact),
        "QUALIFIED_REPLACEMENT_DEPLOY",
        { context: context(authority), mutation: true },
      );
    },
    async readback(authority, effectiveTransport) {
      const version = await read(authority, "QUALIFIED_EXACT");
      await readRoute(
        runtime,
        authority,
        version.versionId,
        effectiveTransport,
        context(authority),
      );
      return version;
    },
    async disable(authority) {
      materializeDisabled(runtime.configuration, authority);
      await child(
        runtime,
        authority,
        [
          "deploy",
          "--config",
          runtime.configuration.disabledConfigPath,
          "--message",
          `videoforge-v2-09-replacement-disabled:${authority.source_commit}`,
          "--x-auto-create",
          "false",
        ],
        "QUALIFIED_REPLACEMENT_DISABLE",
        { context: context(authority), mutation: true, cleanupMutation: true },
      );
      const version = await read(authority, "DISABLED_UNQUALIFIED");
      await readRoute(
        runtime,
        authority,
        version.versionId,
        "DISABLED_UNQUALIFIED",
        context(authority),
      );
      return version;
    },
  });
}

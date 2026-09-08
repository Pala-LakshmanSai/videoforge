import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runCancellableChildProcess } from "../v2-13/full-live-adapters.mjs";
import { createV209CloudflareProductionOperator } from "./cloudflare-production-operator.mjs";
import {
  BRANCH,
  CLEANUP_OPERATIONS,
  COMBINED_EXECUTION_MARKER,
  COMBINED_PRECOMPLETED_OPERATION_IDS,
  COMBINED_RESUME_SCHEMA,
  NORMAL_OPERATIONS,
  OPERATION_IDS,
  PUSH_REF,
  deriveInjectedAdapterIdentity,
} from "./execute-qualified-production.mjs";
import { readRunPodEvidence } from "./read-only-preflight.mjs";
import { createV209MediaWorkerProductionPorts } from "./media-worker-production-operator.mjs";
import { validatePreparationBinding } from "./validate-qualified-production-config.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SOURCE_PATH = fileURLToPath(import.meta.url);
const DIRECT_DEPENDENCY_PATHS = Object.freeze([
  "deploy/v2-09/neon-v209-runtime-grants.sql",
  "deploy/v2-09/neon-qualified-activation-operator-grants.sql",
  "deploy/v2-09/neon-pair-reconciler-grants.sql",
  "deploy/v2-09/neon-persist-qualified-production.sql",
  "deploy/v2-09/neon-import-qualified-activation.sql",
  "deploy/v2-09/neon-read-v209-e2e-cost.sql",
  "deploy/v2-09/neon-read-v209-cleanup-state.sql",
  "deploy/v2-09/neon-reconcile-v209-staged-click.sql",
  "deploy/v2-09/neon-reconcile-v209-unassigned-attempts.sql",
  "deploy/v2-09/neon-settle-v209-success-costs.sql",
  "deploy/v2-09/neon-settle-v209-terminal-pair.sql",
  "deploy/v2-09/neon-deactivate-v209-production.sql",
  "deploy/v2-09/read-only-preflight.mjs",
  "deploy/v2-09/render-qualified-production-config.mjs",
  "deploy/v2-09/v209-runpod-production-bridge.ts",
  "deploy/v2-09/v209-real-chrome-bridge.ts",
  "packages/control-plane/migrations/manifest.json",
  ...Array.from({ length: 12 }, (_, index) => {
    const version = 74 + index;
    const entry = JSON.parse(
      readFileSync(resolve(ROOT, "packages/control-plane/migrations/manifest.json"), "utf8"),
    ).migrations[version - 1];
    return `packages/control-plane/migrations/${entry.filename}`;
  }),
]);
const HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const JOURNAL_SCHEMA = "videoforge.v2-09-qualified-production-journal/v1";
const ADAPTER_IDENTITY_SCHEMA = "videoforge.v2-09-concrete-adapter-identity/v1";
const ADAPTER_SOURCE_IDENTITY_SCHEMA = "videoforge.v2-09-adapter-source-identity/v1";
const CLICK_CLAIM_FILE_SCHEMA = "videoforge.v2-09-click-claim-file/v1";
const CLICK_CREATE_FILE_SCHEMA = "videoforge.v2-09-click-create-request-file/v1";
const CLICK_PROJECT_FILE_SCHEMA = "videoforge.v2-09-click-project-identity-file/v1";
const CLICK_GENERATION_FILE_SCHEMA = "videoforge.v2-09-click-generation-identity-file/v1";
const STATE_METHODS = Object.freeze([
  "claimAuthority",
  "beginNormalOperation",
  "completeNormalOperation",
  "enterCleanupOnly",
  "loadCleanupAuthority",
  "recordCleanupOperation",
  "completeCleanup",
  "completeSuccess",
  "reconcileSuccess",
  "pauseInteractiveChromeLogin",
  "resumeInteractiveChromeLogin",
]);
const CONFIGURATION_KEYS = Object.freeze([
  "branch",
  "chromeAuthStateFile",
  "chromeRequestFile",
  "cloudflare",
  "databaseOperatorUrlFile",
  "databaseOwnerUrlFile",
  "databaseReconcilerUrlFile",
  "environment",
  "journalPath",
  "mediaReleaseManifestFile",
  "mediaWorker",
  "migrationMode",
  "operatorRole",
  "pushRef",
  "qualifiedBindingFile",
  "qualifiedConfigOutputFile",
  "qualifiedConfigReceiptFile",
  "reconcilerRole",
  "remote",
  "root",
  "runpodApiKeyFile",
  "runpodWorkerEnvironmentFile",
  "runtimeRole",
  "sourceCommit",
]);
const CONCRETE_ENVIRONMENT_KEYS = new Set(["HOME", "LANG", "LC_ALL", "PATH"]);
const MEDIA_WORKER_STATIC_ENVIRONMENT_KEYS = new Set(["GH_CONFIG_DIR", "GH_HOST", "PATH"]);
const PROTECTED_INPUT_NAMES = Object.freeze([
  "runpodApiKeyFile",
  "runpodWorkerEnvironmentFile",
  "databaseOwnerUrlFile",
  "databaseOperatorUrlFile",
  "databaseReconcilerUrlFile",
  "chromeRequestFile",
  "chromeAuthStateFile",
  "qualifiedBindingFile",
]);
const DEFERRED_ENDPOINT_SECRET_NAMES = new Set([
  "VIDEOFORGE_MAGE_ENDPOINT_ID",
  "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
  "VIDEOFORGE_SOULX_ENDPOINT_ID",
  "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
]);

// These are the only unresolved low-level seams. Each implementation is source-hash identified;
// their combined identity plus this file's bytes is what the rollout authority approves.
export const REQUIRED_CONCRETE_PORTS = Object.freeze([
  "publishMediaWorker",
  "readbackMediaWorker",
  "installMediaWorker",
  "deployCloudflareDisabled",
  "uploadCloudflareSecrets",
  "deployCloudflareQualified",
  "readbackCloudflareQualified",
  "reconcileCloudflareSafety",
]);

export function createV209BuiltInProductionPorts(configuration) {
  return Object.freeze({
    ...createV209MediaWorkerProductionPorts(configuration.mediaWorker),
    ...createV209CloudflareProductionOperator(configuration.cloudflare),
  });
}

function createV209StagingPorts(configuration) {
  const media = createV209MediaWorkerProductionPorts(configuration.mediaWorker);
  const forbidden = (name) =>
    Object.freeze({
      source_sha256: sha256(`v2-09-staging-forbidden-port:${name}`),
      run: async () => fail(`V2_09_STAGING_PORT_FORBIDDEN:${name}`),
    });
  return Object.freeze({
    ...media,
    deployCloudflareDisabled: forbidden("deployCloudflareDisabled"),
    uploadCloudflareSecrets: Object.freeze({
      ...forbidden("uploadCloudflareSecrets"),
      secret_input_sha256s: Object.freeze({}),
    }),
    deployCloudflareQualified: forbidden("deployCloudflareQualified"),
    readbackCloudflareQualified: forbidden("readbackCloudflareQualified"),
    reconcileCloudflareSafety: forbidden("reconcileCloudflareSafety"),
  });
}

const DIRECT_OPERATION_IDS = new Set([
  "push-clean-source",
  "readback-clean-source",
  "apply-migrations-0074-0086",
  "apply-v209-grants",
  "fresh-read-only-admission",
  "create-mage-production-lane-max-one",
  "create-soulx-production-lane-max-one",
  "persist-qualified-production-deployments",
  "render-qualified-production-config",
  "import-v209-qualified-activation",
  "run-one-v209-chrome-e2e",
  "verify-private-mp4-lineage",
  "reconcile-v209-production-safety",
  "reconcile-attributable-runpod-work",
  "clean-v209-transient-r2",
  "prove-three-zero-compute-reads",
  "read-settled-billing",
  "verify-retained-resources",
]);

const PORT_BY_OPERATION = Object.freeze({
  "publish-media-worker-0.1.15": "publishMediaWorker",
  "readback-media-worker-0.1.15": "readbackMediaWorker",
  "install-media-worker-0.1.15": "installMediaWorker",
  "deploy-cloudflare-disabled-bootstrap": "deployCloudflareDisabled",
  "upload-cloudflare-production-secrets": "uploadCloudflareSecrets",
  "deploy-cloudflare-qualified-production": "deployCloudflareQualified",
  "readback-qualified-production": "readbackCloudflareQualified",
});

function fail(code) {
  throw new Error(code);
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

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function loadV209MigrationBundle() {
  const manifest = parseJson(
    readFileSync(resolve(ROOT, "packages/control-plane/migrations/manifest.json"), "utf8"),
    "MIGRATION_MANIFEST",
  );
  if (
    manifest?.schema_version !== "videoforge-migration-manifest/v1" ||
    !Array.isArray(manifest.migrations) ||
    manifest.migrations.length !== 86 ||
    manifest.migrations.some((entry, index) => entry?.version !== index + 1)
  )
    fail("V2_09_CONCRETE_MIGRATION_MANIFEST_INVALID");
  const entries = manifest.migrations.map((entry) => ({ ...entry }));
  const selected = entries.slice(73).map((entry) => {
    const bytes = readFileSync(resolve(ROOT, "packages/control-plane/migrations", entry.filename));
    if (sha256(bytes) !== entry.sha256) fail("V2_09_CONCRETE_MIGRATION_SOURCE_DRIFT");
    return Object.freeze({ ...entry, sql: bytes.toString("utf8") });
  });
  if (selected.length !== 13 || selected[0].version !== 74 || selected.at(-1).version !== 86)
    fail("V2_09_CONCRETE_MIGRATION_MANIFEST_INVALID");
  const ledger = (length) =>
    canonical(
      entries
        .slice(0, length)
        .map(({ version, name, filename, sha256: digest }) => [version, name, filename, digest]),
    );
  return Object.freeze({ selected, prefixLedger: ledger(73), finalLedger: ledger(86) });
}

function renderV209MigrationSql(bundle, verifyExisting) {
  const expectedBefore = verifyExisting ? bundle.finalLedger : bundle.prefixLedger;
  const guard = (expected, label) =>
    `DO $v209$ BEGIN IF COALESCE((SELECT jsonb_agg(jsonb_build_array(version,name,filename,sha256) ORDER BY version) FROM public.videoforge_schema_migrations),'[]'::jsonb) IS DISTINCT FROM ${sqlLiteral(expected)}::jsonb THEN RAISE EXCEPTION '${label}'; END IF; END $v209$;`;
  const body = verifyExisting
    ? ""
    : bundle.selected
        .map(
          (entry) =>
            `${entry.sql}\nINSERT INTO public.videoforge_schema_migrations(version,name,filename,sha256) VALUES (${entry.version},${sqlLiteral(entry.name)},${sqlLiteral(entry.filename)},${sqlLiteral(entry.sha256)});`,
        )
        .join("\n");
  return [
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    "SELECT pg_advisory_xact_lock(1448494662,9);",
    guard(expectedBefore, "V2-09 migration ledger prefix drift"),
    body,
    guard(bundle.finalLedger, "V2-09 migration ledger final drift"),
    `SELECT jsonb_build_object('schemaVersion','videoforge.v2-09-migration-result/v1','mode','${verifyExisting ? "VERIFIED_EXISTING_0086" : "APPLIED_0074_0086"}','fromVersion',${verifyExisting ? 86 : 73},'toVersion',86);`,
    "COMMIT;",
    "",
  ].join("\n");
}

function usdMicros(value) {
  const amount = Number(value);
  const micros = Math.round(amount * 1_000_000);
  return Number.isFinite(amount) &&
    amount >= 0 &&
    Number.isSafeInteger(micros) &&
    Math.abs(amount - micros / 1_000_000) <= 1e-12
    ? micros
    : Number.NaN;
}

function exactExecutionCostUsd(executionTimeMs, rateUsdPerGpuHour) {
  if (!Number.isSafeInteger(executionTimeMs) || executionTimeMs < 0) return Number.NaN;
  const rate = String(rateUsdPerGpuHour);
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,9}))?$/u.exec(rate);
  if (!match) return Number.NaN;
  const fraction = match[2] ?? "";
  const scale = 10n ** BigInt(fraction.length);
  const rateNumerator = BigInt(match[1]) * scale + BigInt(fraction || "0");
  if (rateNumerator <= 0n) return Number.NaN;
  const denominator = scale * 3_600_000n;
  const numerator = BigInt(executionTimeMs) * rateNumerator * 1_000_000n;
  const micros = (numerator + denominator - 1n) / denominator;
  return micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) / 1_000_000 : Number.NaN;
}

function deterministicUuid(value) {
  const bytes = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = ["8", "9", "a", "b"][Number.parseInt(bytes[16], 16) % 4];
  const hex = bytes.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function postgresEnvironment(configuration, raw) {
  if (raw.trim() !== raw || raw.includes("\0") || raw.length > 8192)
    fail("V2_09_CONCRETE_DATABASE_URL_INVALID");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("V2_09_CONCRETE_DATABASE_URL_INVALID");
  }
  const parameters = [...parsed.searchParams.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (
    parsed.hash !== "" ||
    JSON.stringify(parameters) !==
      JSON.stringify([
        ["channel_binding", "require"],
        ["sslmode", "require"],
      ])
  )
    fail("V2_09_CONCRETE_DATABASE_URL_INVALID");
  if (
    parsed.protocol !== "postgresql:" ||
    parsed.username.length === 0 ||
    parsed.password.length === 0 ||
    parsed.hostname.length === 0 ||
    parsed.pathname.length < 2 ||
    parsed.searchParams.get("sslmode") !== "require"
  )
    fail("V2_09_CONCRETE_DATABASE_URL_INVALID");
  return {
    ...configuration.environment,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: "require",
    PGCHANNELBINDING: "require",
  };
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function validateCombinedJournalHandoff(combinedExecution, executionAuthority, priorResults) {
  if (
    !exactKeys(combinedExecution, [
      "execution_marker",
      "inner_authority_sha256",
      "operations",
      "outer_authority_id",
      "preflight_proof_sha256",
      "receipt_sha256",
      "schema_version",
      "staged_receipts_sha256",
    ]) ||
    combinedExecution.schema_version !== COMBINED_RESUME_SCHEMA ||
    combinedExecution.execution_marker !== COMBINED_EXECUTION_MARKER ||
    !HASH.test(combinedExecution.inner_authority_sha256 ?? "") ||
    combinedExecution.inner_authority_sha256 !== sha256(canonical(executionAuthority)) ||
    !HASH.test(combinedExecution.staged_receipts_sha256 ?? "") ||
    !HASH.test(combinedExecution.receipt_sha256 ?? "") ||
    !Array.isArray(combinedExecution.operations) ||
    combinedExecution.operations.length !== COMBINED_PRECOMPLETED_OPERATION_IDS.length
  )
    fail("V2_09_CONCRETE_COMBINED_HANDOFF_INVALID");
  const unsigned = { ...combinedExecution };
  delete unsigned.receipt_sha256;
  const expectedInnerId = `v2-09-inner-${sha256(
    canonical({
      outerAuthorityId: combinedExecution.outer_authority_id,
      preflightProof: combinedExecution.preflight_proof_sha256,
      stagedReceiptsSha256: combinedExecution.staged_receipts_sha256,
    }),
  ).slice(7, 31)}`;
  if (
    executionAuthority.authority_id !== expectedInnerId ||
    sha256(canonical(unsigned)) !== combinedExecution.receipt_sha256
  )
    fail("V2_09_CONCRETE_COMBINED_HANDOFF_INVALID");
  combinedExecution.operations.forEach((receipt, index) => {
    const operationId = COMBINED_PRECOMPLETED_OPERATION_IDS[index];
    if (
      !exactKeys(receipt, ["operation_id", "result", "result_sha256"]) ||
      receipt.operation_id !== operationId ||
      receipt.result_sha256 !== sha256(canonical(receipt.result)) ||
      canonical(priorResults[operationId]) !== canonical(receipt.result)
    )
      fail("V2_09_CONCRETE_COMBINED_HANDOFF_INVALID");
  });
  return combinedExecution.outer_authority_id;
}

function readBoundInnerJournal({
  configuration,
  executionAuthority,
  journalAuthorityId,
  combinedExecution,
  priorResults,
}) {
  if (
    configuration === null ||
    typeof configuration !== "object" ||
    configuration.sourceCommit !== executionAuthority?.source_commit
  )
    fail("V2_09_INNER_CLEANUP_PROOF_INVALID");
  const validatedOuterId = validateCombinedJournalHandoff(
    combinedExecution,
    executionAuthority,
    priorResults,
  );
  if (journalAuthorityId !== validatedOuterId) fail("V2_09_INNER_CLEANUP_PROOF_INVALID");
  const journal = readJournal(configuration.journalPath);
  if (
    journal.authority_id !== validatedOuterId ||
    journal.proposal_sha256 !== executionAuthority.proposal_sha256 ||
    journal.source_commit !== executionAuthority.source_commit
  )
    fail("V2_09_INNER_CLEANUP_PROOF_INVALID");
  for (const receipt of combinedExecution.operations) {
    if (
      journal.normal[receipt.operation_id]?.status !== "COMPLETED" ||
      journal.normal[receipt.operation_id].result_sha256 !== receipt.result_sha256
    )
      fail("V2_09_INNER_CLEANUP_PROOF_INVALID");
  }
  return journal;
}

function validateCleanupAttempts(cleanup, { finalOutcome }) {
  const cleanupIds = CLEANUP_OPERATIONS.map(({ id }) => id);
  if (cleanup.length < cleanupIds.length) fail("V2_09_INNER_CLEANUP_PROOF_INVALID");
  let cleanupPosition = 0;
  let attemptOutcome = null;
  let lastCompletedOutcome = null;
  for (const entry of cleanup) {
    if (entry.operation_id === cleanupIds[0] && cleanupPosition !== 0) {
      cleanupPosition = 0;
      attemptOutcome = null;
    }
    if (
      !exactKeys(entry, ["operation_id", "outcome", "result_sha256"]) ||
      entry.operation_id !== cleanupIds[cleanupPosition] ||
      !["SUCCESS", "FAILURE"].includes(entry.outcome) ||
      !HASH.test(entry.result_sha256 ?? "")
    )
      fail("V2_09_INNER_CLEANUP_PROOF_INVALID");
    if (cleanupPosition === 0) attemptOutcome = entry.outcome;
    else if (entry.outcome !== attemptOutcome) fail("V2_09_INNER_CLEANUP_PROOF_INVALID");
    cleanupPosition = (cleanupPosition + 1) % cleanupIds.length;
    if (cleanupPosition === 0) lastCompletedOutcome = attemptOutcome;
  }
  if (cleanupPosition !== 0 || lastCompletedOutcome !== finalOutcome)
    fail("V2_09_INNER_CLEANUP_PROOF_INVALID");
}

export function hasV209InnerFailedClean(input) {
  const journal = readBoundInnerJournal(input);
  if (journal.status !== "FAILED_CLEAN") return false;
  validateCleanupAttempts(journal.cleanup, { finalOutcome: "FAILURE" });
  return true;
}

export function readV209InnerSucceededClean(input) {
  const journal = readBoundInnerJournal(input);
  if (journal.status !== "SUCCEEDED_CLEAN") return null;
  const normalIds = NORMAL_OPERATIONS.map(({ id }) => id);
  if (canonical(Object.keys(journal.normal).sort()) !== canonical([...normalIds].sort()))
    fail("V2_09_INNER_SUCCESS_PROOF_INVALID");
  for (const operationId of normalIds) {
    if (
      !exactKeys(journal.normal[operationId], ["result_sha256", "status"]) ||
      journal.normal[operationId].status !== "COMPLETED" ||
      !HASH.test(journal.normal[operationId].result_sha256 ?? "")
    )
      fail("V2_09_INNER_SUCCESS_PROOF_INVALID");
  }
  if (journal.cleanup.length !== CLEANUP_OPERATIONS.length)
    fail("V2_09_INNER_SUCCESS_PROOF_INVALID");
  validateCleanupAttempts(journal.cleanup, { finalOutcome: "SUCCESS" });
  return Object.freeze({
    schema_version: "videoforge.v2-09-qualified-production-execution/v1",
    authority_id: input.executionAuthority.authority_id,
    status: "SUCCEEDED_CLEAN",
    operations: Object.freeze([...OPERATION_IDS]),
    paid_dispatch_count: 1,
    redispatch_count: 0,
  });
}

function assertPrivateRegularPath(path, { mayNotExist = false } = {}) {
  if (typeof path !== "string" || !isAbsolute(path)) fail("V2_09_CONCRETE_PATH_INVALID");
  const parent = dirname(path);
  const parentStat = lstatSync(parent);
  if (
    parentStat.isSymbolicLink() ||
    !parentStat.isDirectory() ||
    (parentStat.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && parentStat.uid !== process.getuid())
  )
    fail("V2_09_CONCRETE_PATH_PARENT_INVALID");
  if (mayNotExist && !existsSync(path)) return;
  const stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    fail("V2_09_CONCRETE_PRIVATE_FILE_INVALID");
}

function cloneAndFreeze(value) {
  if (value === null || typeof value !== "object") {
    if (!["string", "number", "boolean"].includes(typeof value) && value !== null)
      fail("V2_09_CONCRETE_CONFIGURATION_INVALID");
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze));
  if (Object.getPrototypeOf(value) !== Object.prototype)
    fail("V2_09_CONCRETE_CONFIGURATION_INVALID");
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneAndFreeze(item)])),
  );
}

function snapshotConcreteConfiguration(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== [...CONFIGURATION_KEYS].sort().join(",") ||
    value.environment === null ||
    typeof value.environment !== "object" ||
    Array.isArray(value.environment) ||
    Object.keys(value.environment).some(
      (key) => !CONCRETE_ENVIRONMENT_KEYS.has(key) || typeof value.environment[key] !== "string",
    )
  )
    fail("V2_09_CONCRETE_CONFIGURATION_INVALID");
  return cloneAndFreeze(value);
}

function hydrateMediaWorkerConfiguration(configuration, protectedInputs) {
  const mediaWorker = configuration.mediaWorker;
  if (
    mediaWorker === null ||
    typeof mediaWorker !== "object" ||
    Array.isArray(mediaWorker) ||
    mediaWorker.environment === null ||
    typeof mediaWorker.environment !== "object" ||
    Array.isArray(mediaWorker.environment) ||
    Object.entries(mediaWorker.environment).some(
      ([name, entry]) =>
        !MEDIA_WORKER_STATIC_ENVIRONMENT_KEYS.has(name) || typeof entry !== "string",
    ) ||
    resolve(mediaWorker.databaseCredentialPath ?? "") !==
      resolve(configuration.databaseOperatorUrlFile) ||
    protectedInputs?.databaseOperatorUrlFile?.bytes === undefined ||
    resolve(mediaWorker.heartbeatCredentialPath ?? "") !==
      resolve(configuration.databaseOwnerUrlFile) ||
    Object.hasOwn(mediaWorker, "heartbeatEnvironment") ||
    protectedInputs?.databaseOwnerUrlFile?.bytes === undefined
  )
    fail("V2_09_CONCRETE_MEDIA_WORKER_CONFIGURATION_INVALID");
  const operatorUrl = protectedInputs.databaseOperatorUrlFile.bytes.toString("utf8");
  const environment = postgresEnvironment({ environment: mediaWorker.environment }, operatorUrl);
  const heartbeatEnvironment = postgresEnvironment(
    { environment: mediaWorker.environment },
    protectedInputs.databaseOwnerUrlFile.bytes.toString("utf8"),
  );
  return cloneAndFreeze({
    ...configuration,
    mediaWorker: { ...mediaWorker, environment, heartbeatEnvironment },
  });
}

function snapshotConcreteConfigurationWithHydratedMediaWorker(value, protectedInputOptions) {
  const base = snapshotConcreteConfiguration(value);
  const protectedInputs = protectedInputSnapshot(base, protectedInputOptions);
  return Object.freeze({
    configuration: hydrateMediaWorkerConfiguration(base, protectedInputs),
    protectedInputs,
  });
}

function protectedInputSnapshot(
  configuration,
  { allowDeferredEndpointSecrets = false, skipChrome = false } = {},
) {
  const protectedNames = skipChrome
    ? PROTECTED_INPUT_NAMES.filter(
        (name) => !["chromeRequestFile", "chromeAuthStateFile"].includes(name),
      )
    : PROTECTED_INPUT_NAMES;
  const inputs = Object.fromEntries(
    protectedNames.map((name) => {
      const path = configuration[name];
      let descriptor;
      let stat;
      let bytes;
      try {
        descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        stat = fstatSync(descriptor);
        bytes = Buffer.from(readFileSync(descriptor));
      } catch {
        fail("V2_09_CONCRETE_PROTECTED_INPUT_INVALID");
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        (stat.mode & 0o777) !== 0o600 ||
        (typeof process.getuid === "function" && stat.uid !== process.getuid())
      )
        fail("V2_09_CONCRETE_PROTECTED_INPUT_INVALID");
      return [
        name,
        Object.freeze({
          bytes,
          sha256: sha256(bytes),
          dev: stat.dev,
          ino: stat.ino,
          mode: stat.mode,
          uid: stat.uid,
          nlink: stat.nlink,
          size: stat.size,
        }),
      ];
    }),
  );
  const cloudflareSecretFiles = configuration.cloudflare?.secretFiles;
  if (
    cloudflareSecretFiles === null ||
    typeof cloudflareSecretFiles !== "object" ||
    Array.isArray(cloudflareSecretFiles)
  )
    fail("V2_09_CONCRETE_PROTECTED_INPUT_INVALID");
  inputs.cloudflareSecretFiles = Object.freeze(
    Object.fromEntries(
      Object.entries(cloudflareSecretFiles)
        .filter(([name, path]) => {
          if (existsSync(path)) return true;
          if (allowDeferredEndpointSecrets && DEFERRED_ENDPOINT_SECRET_NAMES.has(name))
            return false;
          fail("V2_09_CONCRETE_PROTECTED_INPUT_INVALID");
        })
        .map(([name, path]) => {
          const reusedName = PROTECTED_INPUT_NAMES.find(
            (inputName) => resolve(configuration[inputName]) === resolve(path),
          );
          if (reusedName !== undefined) return [name, inputs[reusedName]];
          let descriptor;
          let stat;
          let bytes;
          try {
            descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
            stat = fstatSync(descriptor);
            bytes = Buffer.from(readFileSync(descriptor));
          } catch {
            fail("V2_09_CONCRETE_PROTECTED_INPUT_INVALID");
          } finally {
            if (descriptor !== undefined) closeSync(descriptor);
          }
          if (
            !stat.isFile() ||
            stat.nlink !== 1 ||
            (stat.mode & 0o777) !== 0o600 ||
            (typeof process.getuid === "function" && stat.uid !== process.getuid())
          )
            fail("V2_09_CONCRETE_PROTECTED_INPUT_INVALID");
          return [
            name,
            Object.freeze({
              bytes,
              dev: stat.dev,
              ino: stat.ino,
              mode: stat.mode,
              uid: stat.uid,
              nlink: stat.nlink,
              sha256: sha256(bytes),
              size: stat.size,
            }),
          ];
        }),
    ),
  );
  return Object.freeze(inputs);
}

function readPrivateBytesOnce(path) {
  assertPrivateRegularPath(path);
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    const bytes = Buffer.from(readFileSync(descriptor));
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    )
      fail("V2_09_CONCRETE_PRIVATE_FILE_INVALID");
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_09_")) throw error;
    fail("V2_09_CONCRETE_PRIVATE_FILE_INVALID");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateChromeDocument(configuration, bytes) {
  const document = parseJson(bytes.toString("utf8"), "CHROME_REQUEST");
  const request = document?.request;
  const prepared = request?.prepared;
  let origin;
  if (typeof document?.productionOrigin === "string") {
    try {
      origin = new URL(document.productionOrigin);
    } catch {
      origin = null;
    }
  }
  if (
    !exactKeys(document, [
      "authStatePath",
      "productionOrigin",
      "request",
      "schemaVersion",
      "verifiedOutputPath",
      "voiceoverPath",
    ]) ||
    document.schemaVersion !== "videoforge.v2-09-real-chrome-production-request/v1" ||
    resolve(document.authStatePath ?? "") !== resolve(configuration.chromeAuthStateFile) ||
    typeof document.voiceoverPath !== "string" ||
    !isAbsolute(document.voiceoverPath) ||
    typeof document.verifiedOutputPath !== "string" ||
    !isAbsolute(document.verifiedOutputPath) ||
    !origin ||
    origin.protocol !== "https:" ||
    origin.origin !== document.productionOrigin ||
    !exactKeys(request, [
      "accountId",
      "maxProgressReads",
      "pollIntervalMs",
      "prepared",
      "schemaVersion",
      "source",
      "stopAt",
      "workspaceId",
    ]) ||
    request.schemaVersion !== "videoforge.v2-09-real-chrome-operator-request/v1" ||
    request.source !== "HOSTED_V209_ORDINARY" ||
    !UUID.test(request.accountId ?? "") ||
    !UUID.test(request.workspaceId ?? "") ||
    !Number.isSafeInteger(request.maxProgressReads) ||
    request.maxProgressReads < 1 ||
    request.maxProgressReads > 1_000 ||
    !Number.isSafeInteger(request.pollIntervalMs) ||
    request.pollIntervalMs < 0 ||
    request.pollIntervalMs > 60_000 ||
    typeof request.stopAt !== "string" ||
    !UTC_MILLISECONDS.test(request.stopAt) ||
    !Number.isFinite(Date.parse(request.stopAt)) ||
    new Date(Date.parse(request.stopAt)).toISOString() !== request.stopAt ||
    !exactKeys(prepared, [
      "avatarProfileVersionId",
      "imageStyleVersionId",
      "title",
      "voiceoverContentLength",
      "voiceoverContentType",
      "voiceoverDurationMs",
      "voiceoverFilename",
      "voiceoverSha256",
    ]) ||
    typeof prepared.title !== "string" ||
    prepared.title.trim() !== prepared.title ||
    prepared.title.length < 1 ||
    prepared.title.length > 240 ||
    typeof prepared.voiceoverFilename !== "string" ||
    prepared.voiceoverFilename.length < 1 ||
    prepared.voiceoverFilename.length > 160 ||
    prepared.voiceoverFilename.includes("/") ||
    prepared.voiceoverFilename.includes("\\") ||
    !["audio/wav", "audio/mpeg"].includes(prepared.voiceoverContentType) ||
    !Number.isSafeInteger(prepared.voiceoverContentLength) ||
    prepared.voiceoverContentLength < 1 ||
    prepared.voiceoverContentLength > 1_073_741_824 ||
    !HASH.test(prepared.voiceoverSha256 ?? "") ||
    !Number.isSafeInteger(prepared.voiceoverDurationMs) ||
    prepared.voiceoverDurationMs < 30_000 ||
    prepared.voiceoverDurationMs > 60_000 ||
    !IDENTIFIER.test(prepared.avatarProfileVersionId ?? "") ||
    !IDENTIFIER.test(prepared.imageStyleVersionId ?? "")
  )
    fail("V2_09_CONCRETE_CHROME_REQUEST_INVALID");
  assertPrivateRegularPath(document.verifiedOutputPath, { mayNotExist: true });
  const voiceoverBytes = readPrivateBytesOnce(document.voiceoverPath);
  if (
    basename(document.voiceoverPath) !== prepared.voiceoverFilename ||
    voiceoverBytes.length !== prepared.voiceoverContentLength ||
    sha256(voiceoverBytes) !== prepared.voiceoverSha256
  )
    fail("V2_09_CONCRETE_CHROME_REQUEST_INVALID");
  return cloneAndFreeze(document);
}

function clickIdentityPaths(journalPath, authorityId, requestSha256) {
  const binding = sha256(`${authorityId}:${requestSha256}`).slice(7, 31);
  const base = `${journalPath}.chrome-click.${binding}.json`;
  return Object.freeze({
    base,
    claim: `${base}.claim.json`,
    create: `${base}.create-request.json`,
    project: `${base}.project.json`,
  });
}

function validateClickIdentityStage({ authority, chromeDocument, paths }) {
  const requestSha256 = sha256(canonical(chromeDocument.request));
  const expectedClaimId = sha256(`${authority.authority_id}:${requestSha256}`);
  const expected = {
    authorityId: authority.authority_id,
    requestSha256,
    source: "HOSTED_V209_ORDINARY",
    accountId: chromeDocument.request.accountId,
    workspaceId: chromeDocument.request.workspaceId,
    voiceoverSha256: chromeDocument.request.prepared.voiceoverSha256,
    claimId: expectedClaimId,
  };
  const read = (path, schemaVersion) => {
    if (!existsSync(path)) return null;
    const value = parseJson(readPrivateBytesOnce(path).toString("utf8"), "CLICK_IDENTITY");
    if (
      value?.schema_version !== schemaVersion ||
      value.authority_id !== expected.authorityId ||
      value.request_sha256 !== expected.requestSha256
    )
      fail("V2_09_CONCRETE_CLICK_IDENTITY_INVALID");
    return value;
  };
  const claimDocument = read(paths.claim, CLICK_CLAIM_FILE_SCHEMA);
  const createDocument = read(paths.create, CLICK_CREATE_FILE_SCHEMA);
  const projectDocument = read(paths.project, CLICK_PROJECT_FILE_SCHEMA);
  const generationDocument = read(paths.base, CLICK_GENERATION_FILE_SCHEMA);
  if (generationDocument && !projectDocument) fail("V2_09_CONCRETE_CLICK_IDENTITY_INVALID");
  if (projectDocument && !createDocument) fail("V2_09_CONCRETE_CLICK_IDENTITY_INVALID");
  if (createDocument && !claimDocument) fail("V2_09_CONCRETE_CLICK_IDENTITY_INVALID");
  if (!claimDocument) return null;
  const claim = claimDocument.claim;
  if (
    !exactKeys(claimDocument, ["authority_id", "claim", "request_sha256", "schema_version"]) ||
    !exactKeys(claim, [
      "accountId",
      "claimId",
      "clickOrdinal",
      "source",
      "voiceoverSha256",
      "workspaceId",
    ]) ||
    claim.accountId !== expected.accountId ||
    claim.workspaceId !== expected.workspaceId ||
    claim.claimId !== expected.claimId ||
    claim.clickOrdinal !== 1 ||
    claim.source !== expected.source ||
    claim.voiceoverSha256 !== expected.voiceoverSha256
  )
    fail("V2_09_CONCRETE_CLICK_IDENTITY_INVALID");
  let stage = "CLAIMED";
  let identity = null;
  let lookup = null;
  if (createDocument) {
    identity = createDocument.identity;
    if (
      !exactKeys(createDocument, [
        "authority_id",
        "identity",
        "request_sha256",
        "schema_version",
      ]) ||
      !exactKeys(identity, [
        "accountId",
        "claimId",
        "clickOrdinal",
        "createRequestSha256",
        "idempotencyKey",
        "schemaVersion",
        "source",
        "voiceoverSha256",
        "workspaceId",
      ]) ||
      identity.schemaVersion !== "videoforge.v2-09-create-request-identity/v1" ||
      identity.accountId !== expected.accountId ||
      identity.workspaceId !== expected.workspaceId ||
      identity.claimId !== expected.claimId ||
      identity.clickOrdinal !== 1 ||
      identity.source !== expected.source ||
      identity.voiceoverSha256 !== expected.voiceoverSha256 ||
      !IDENTIFIER.test(identity.idempotencyKey ?? "") ||
      !HASH.test(identity.createRequestSha256 ?? "")
    )
      fail("V2_09_CONCRETE_CLICK_IDENTITY_INVALID");
    stage = "CREATE_REQUESTED";
    lookup = {
      idempotencyKey: identity.idempotencyKey,
      createRequestSha256: identity.createRequestSha256,
    };
  }
  if (projectDocument) {
    const projectIdentity = projectDocument.identity;
    if (
      !exactKeys(projectDocument, [
        "authority_id",
        "identity",
        "lookup",
        "request_sha256",
        "schema_version",
      ]) ||
      !exactKeys(projectDocument.lookup, ["createRequestSha256", "idempotencyKey"]) ||
      !exactKeys(projectIdentity, [
        "accountId",
        "claimId",
        "clickOrdinal",
        "createRequestSha256",
        "generationRequestId",
        "idempotencyKey",
        "projectId",
        "projectRevisionId",
        "schemaVersion",
        "source",
        "voiceoverSha256",
        "workspaceId",
      ]) ||
      projectIdentity.schemaVersion !== "videoforge.v2-09-project-identity/v1" ||
      projectIdentity.accountId !== expected.accountId ||
      projectIdentity.workspaceId !== expected.workspaceId ||
      projectIdentity.claimId !== expected.claimId ||
      projectIdentity.clickOrdinal !== 1 ||
      projectIdentity.source !== expected.source ||
      projectIdentity.voiceoverSha256 !== expected.voiceoverSha256 ||
      projectIdentity.idempotencyKey !== identity.idempotencyKey ||
      projectIdentity.createRequestSha256 !== identity.createRequestSha256 ||
      projectIdentity.generationRequestId !== null ||
      !UUID.test(projectIdentity.projectId ?? "") ||
      !UUID.test(projectIdentity.projectRevisionId ?? "") ||
      projectDocument.lookup.idempotencyKey !== projectIdentity.idempotencyKey ||
      projectDocument.lookup.createRequestSha256 !== projectIdentity.createRequestSha256
    )
      fail("V2_09_CONCRETE_CLICK_IDENTITY_INVALID");
    identity = projectIdentity;
    lookup = projectDocument.lookup;
    stage = "PROJECT_CREATED";
  }
  if (generationDocument) {
    const generationIdentity = generationDocument.identity;
    if (
      !exactKeys(generationDocument, [
        "authority_id",
        "identity",
        "request_sha256",
        "schema_version",
      ]) ||
      !exactKeys(generationIdentity, [
        "accountId",
        "claimId",
        "clickOrdinal",
        "createRequestSha256",
        "generateClickCount",
        "generationRequestId",
        "idempotencyKey",
        "projectId",
        "projectRevisionId",
        "schemaVersion",
        "source",
        "voiceoverSha256",
        "workspaceId",
      ]) ||
      generationIdentity.schemaVersion !== "videoforge.v2-09-generate-click-identity/v1" ||
      generationIdentity.accountId !== identity.accountId ||
      generationIdentity.workspaceId !== identity.workspaceId ||
      generationIdentity.claimId !== identity.claimId ||
      generationIdentity.clickOrdinal !== 1 ||
      generationIdentity.generateClickCount !== 1 ||
      generationIdentity.source !== identity.source ||
      generationIdentity.voiceoverSha256 !== identity.voiceoverSha256 ||
      generationIdentity.idempotencyKey !== identity.idempotencyKey ||
      generationIdentity.createRequestSha256 !== identity.createRequestSha256 ||
      generationIdentity.projectId !== identity.projectId ||
      generationIdentity.projectRevisionId !== identity.projectRevisionId ||
      !UUID.test(generationIdentity.generationRequestId ?? "")
    )
      fail("V2_09_CONCRETE_CLICK_IDENTITY_INVALID");
    identity = generationIdentity;
    stage = "GENERATION_CREATED";
  }
  return cloneAndFreeze({
    schemaVersion: "videoforge.v2-09-click-identity-journal/v1",
    stage,
    requestSha256,
    claimId: expectedClaimId,
    lookup,
    identity,
  });
}

function writeFsyncedJson(path, value, { exclusive = false } = {}) {
  assertPrivateRegularPath(path, { mayNotExist: true });
  const temporary = `${path}.next`;
  if (existsSync(temporary)) fail("V2_09_CONCRETE_JOURNAL_TEMP_EXISTS");
  let file;
  try {
    file = openSync(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    writeFileSync(file, `${canonical(value)}\n`, "utf8");
    fsyncSync(file);
  } finally {
    if (file !== undefined) closeSync(file);
  }
  if (exclusive && existsSync(path)) {
    unlinkSync(temporary);
    fail("V2_09_CONCRETE_AUTHORITY_ALREADY_CONSUMED");
  }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), fsConstants.O_RDONLY);
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function materializeSealedInput(journalPath, label, bytes) {
  const digest = sha256(bytes);
  const path = `${journalPath}.${label}.${digest.slice(7, 23)}.snapshot`;
  if (existsSync(path)) {
    assertPrivateRegularPath(path);
    if (sha256(readPrivateBytesOnce(path)) !== digest) fail("V2_09_CONCRETE_SEALED_INPUT_DRIFT");
    return path;
  }
  const temporary = `${path}.next`;
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, bytes);
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
  if (sha256(readPrivateBytesOnce(path)) !== digest) fail("V2_09_CONCRETE_SEALED_INPUT_DRIFT");
  return path;
}

function readJournal(path) {
  assertPrivateRegularPath(path);
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (
    !exactKeys(value, [
      "adapter_identity_sha256",
      "authority_id",
      "cleanup",
      "normal",
      "proposal_sha256",
      "resources",
      "schema_version",
      "source_commit",
      "status",
    ]) ||
    value.schema_version !== JOURNAL_SCHEMA ||
    !HASH.test(value.adapter_identity_sha256 ?? "") ||
    !COMMIT.test(value.source_commit ?? "") ||
    !HASH.test(value.proposal_sha256 ?? "") ||
    value.resources === null ||
    typeof value.resources !== "object" ||
    Array.isArray(value.resources) ||
    value.normal === null ||
    typeof value.normal !== "object" ||
    Array.isArray(value.normal) ||
    !Array.isArray(value.cleanup)
  )
    fail("V2_09_CONCRETE_JOURNAL_INVALID");
  return value;
}

function createJournalState({ journalPath, adapterIdentitySha256 }) {
  const save = (value, exclusive = false) => writeFsyncedJson(journalPath, value, { exclusive });
  return Object.freeze({
    async claimAuthority({ authority }) {
      const state = {
        schema_version: JOURNAL_SCHEMA,
        authority_id: authority.authority_id,
        proposal_sha256: authority.proposal_sha256,
        source_commit: authority.source_commit,
        adapter_identity_sha256: adapterIdentitySha256,
        status: "CLAIMED",
        normal: {},
        cleanup: [],
        resources: {},
      };
      save(state, true);
      return { authority_id: authority.authority_id, status: "CLAIMED", consumed_once: true };
    },
    async beginNormalOperation({ authorityId, operationId, redispatchAllowed }) {
      const state = readJournal(journalPath);
      if (
        state.authority_id !== authorityId ||
        state.status !== "CLAIMED" ||
        redispatchAllowed !== false ||
        !OPERATION_IDS.includes(operationId) ||
        state.normal[operationId] !== undefined
      )
        fail("V2_09_CONCRETE_NORMAL_REENTRY_FORBIDDEN");
      state.normal[operationId] = { status: "STARTED" };
      save(state);
      return {
        authority_id: authorityId,
        operation_id: operationId,
        status: "STARTED",
        first_start: true,
      };
    },
    async completeNormalOperation({ authorityId, operationId, result }) {
      const state = readJournal(journalPath);
      if (
        state.authority_id !== authorityId ||
        state.status !== "CLAIMED" ||
        state.normal[operationId]?.status !== "STARTED"
      )
        fail("V2_09_CONCRETE_NORMAL_COMPLETION_INVALID");
      state.normal[operationId] = { status: "COMPLETED", result_sha256: sha256(canonical(result)) };
      save(state);
      return { authority_id: authorityId, operation_id: operationId, status: "COMPLETED" };
    },
    async enterCleanupOnly({ authorityId }) {
      const state = readJournal(journalPath);
      if (state.authority_id !== authorityId || !["CLAIMED", "CLEANUP_ONLY"].includes(state.status))
        fail("V2_09_CONCRETE_CLEANUP_TRANSITION_INVALID");
      state.status = "CLEANUP_ONLY";
      save(state);
      return { authority_id: authorityId, status: "CLEANUP_ONLY" };
    },
    async loadCleanupAuthority({ authority }) {
      const state = readJournal(journalPath);
      if (
        state.authority_id !== authority.authority_id ||
        state.proposal_sha256 !== authority.proposal_sha256 ||
        state.source_commit !== authority.source_commit ||
        state.adapter_identity_sha256 !== adapterIdentitySha256 ||
        !["CLAIMED", "CLEANUP_ONLY"].includes(state.status)
      )
        fail("V2_09_CONCRETE_CLEANUP_AUTHORITY_INVALID");
      if (state.status === "CLAIMED") {
        state.status = "CLEANUP_ONLY";
        save(state);
      }
      return { authority_id: authority.authority_id, status: "CLEANUP_ONLY" };
    },
    async recordCleanupOperation({ authorityId, operationId, outcome, result }) {
      const state = readJournal(journalPath);
      if (
        state.authority_id !== authorityId ||
        !["CLAIMED", "CLEANUP_ONLY"].includes(state.status) ||
        !OPERATION_IDS.includes(operationId)
      )
        fail("V2_09_CONCRETE_CLEANUP_RECORD_INVALID");
      state.cleanup.push({
        operation_id: operationId,
        outcome,
        result_sha256: sha256(canonical(result)),
      });
      save(state);
      return { authority_id: authorityId, operation_id: operationId, status: "CLEANUP_RECORDED" };
    },
    async completeCleanup({ authorityId }) {
      const state = readJournal(journalPath);
      if (state.authority_id !== authorityId || state.status !== "CLEANUP_ONLY")
        fail("V2_09_CONCRETE_CLEANUP_COMPLETION_INVALID");
      state.status = "FAILED_CLEAN";
      save(state);
      return { authority_id: authorityId, status: "FAILED_CLEAN" };
    },
    async completeSuccess({ authorityId }) {
      const state = readJournal(journalPath);
      if (state.authority_id !== authorityId || state.status !== "CLAIMED")
        fail("V2_09_CONCRETE_SUCCESS_COMPLETION_INVALID");
      state.status = "SUCCEEDED_CLEAN";
      save(state);
      return { authority_id: authorityId, status: "SUCCEEDED_CLEAN" };
    },
    async reconcileSuccess({ authorityId }) {
      const state = readJournal(journalPath);
      if (state.authority_id !== authorityId) fail("V2_09_CONCRETE_SUCCESS_RECONCILIATION_INVALID");
      return {
        authority_id: authorityId,
        status: state.status === "SUCCEEDED_CLEAN" ? "SUCCEEDED_CLEAN" : "NOT_SUCCEEDED",
      };
    },
    async pauseInteractiveChromeLogin({ authorityId }) {
      const state = readJournal(journalPath);
      const deployed = [
        "deploy-cloudflare-disabled-bootstrap",
        "upload-cloudflare-production-secrets",
        "deploy-cloudflare-qualified-production",
        "readback-qualified-production",
        "import-v209-qualified-activation",
      ].every((operationId) => state.normal[operationId]?.status === "COMPLETED");
      if (
        state.authority_id !== authorityId ||
        state.status !== "CLAIMED" ||
        !deployed ||
        state.normal["run-one-v209-chrome-e2e"] !== undefined
      )
        fail("V2_09_CONCRETE_CHROME_LOGIN_PAUSE_INVALID");
      state.status = "AWAITING_INTERACTIVE_CHROME_LOGIN";
      save(state);
      return { authority_id: authorityId, status: "AWAITING_INTERACTIVE_CHROME_LOGIN" };
    },
    async resumeInteractiveChromeLogin({ authorityId }) {
      const state = readJournal(journalPath);
      if (
        state.authority_id !== authorityId ||
        state.status !== "AWAITING_INTERACTIVE_CHROME_LOGIN" ||
        state.normal["run-one-v209-chrome-e2e"] !== undefined
      )
        fail("V2_09_CONCRETE_CHROME_LOGIN_RESUME_INVALID");
      state.status = "CLAIMED";
      save(state);
      return { authority_id: authorityId, status: "CLAIMED" };
    },
  });
}

function mapJournalAuthority(
  state,
  journalPath,
  journalAuthorityId,
  executionAuthorityId,
  combinedExecution,
) {
  if (journalAuthorityId === null || journalAuthorityId === executionAuthorityId) return state;
  const mappedId = (authorityId) => {
    if (authorityId !== executionAuthorityId) fail("V2_09_CONCRETE_HANDOFF_AUTHORITY_INVALID");
    return journalAuthorityId;
  };
  const remap = async (promise) => ({ ...(await promise), authority_id: executionAuthorityId });
  const adopted = new Map(
    (combinedExecution?.operations ?? []).map((entry) => [entry.operation_id, entry]),
  );
  return Object.freeze({
    async claimAuthority({ authority }) {
      mappedId(authority?.authority_id);
      const journal = readJournal(journalPath);
      if (
        journal.authority_id !== journalAuthorityId ||
        journal.proposal_sha256 !== authority.proposal_sha256 ||
        journal.source_commit !== authority.source_commit ||
        !["CLAIMED", "AWAITING_INTERACTIVE_CHROME_LOGIN", "CLEANUP_ONLY"].includes(journal.status)
      )
        fail("V2_09_CONCRETE_HANDOFF_AUTHORITY_INVALID");
      return { authority_id: executionAuthorityId, status: journal.status, consumed_once: true };
    },
    async beginNormalOperation({ authorityId, operationId, ...rest }) {
      mappedId(authorityId);
      const receipt = adopted.get(operationId);
      if (receipt !== undefined) {
        const journal = readJournal(journalPath);
        if (
          journal.normal[operationId]?.status !== "COMPLETED" ||
          journal.normal[operationId].result_sha256 !== receipt.result_sha256
        )
          fail("V2_09_CONCRETE_HANDOFF_RECEIPT_INVALID");
        return {
          authority_id: executionAuthorityId,
          operation_id: operationId,
          status: "STARTED",
          first_start: true,
        };
      }
      return remap(
        state.beginNormalOperation({
          authorityId: journalAuthorityId,
          operationId,
          ...rest,
        }),
      );
    },
    async completeNormalOperation({ authorityId, operationId, result, ...rest }) {
      mappedId(authorityId);
      const receipt = adopted.get(operationId);
      if (receipt !== undefined) {
        const journal = readJournal(journalPath);
        if (
          receipt.result_sha256 !== sha256(canonical(result)) ||
          journal.normal[operationId]?.status !== "COMPLETED" ||
          journal.normal[operationId].result_sha256 !== receipt.result_sha256
        )
          fail("V2_09_CONCRETE_HANDOFF_RECEIPT_INVALID");
        return {
          authority_id: executionAuthorityId,
          operation_id: operationId,
          status: "COMPLETED",
        };
      }
      return remap(
        state.completeNormalOperation({
          authorityId: journalAuthorityId,
          operationId,
          result,
          ...rest,
        }),
      );
    },
    enterCleanupOnly: ({ authorityId, ...rest }) =>
      remap(state.enterCleanupOnly({ authorityId: mappedId(authorityId), ...rest })),
    async loadCleanupAuthority({ authority }) {
      mappedId(authority?.authority_id);
      const journal = readJournal(journalPath);
      if (
        journal.authority_id !== journalAuthorityId ||
        journal.proposal_sha256 !== authority.proposal_sha256 ||
        journal.source_commit !== authority.source_commit ||
        !["CLAIMED", "AWAITING_INTERACTIVE_CHROME_LOGIN", "CLEANUP_ONLY"].includes(journal.status)
      )
        fail("V2_09_CONCRETE_HANDOFF_AUTHORITY_INVALID");
      if (journal.status !== "CLEANUP_ONLY") {
        journal.status = "CLEANUP_ONLY";
        writeFsyncedJson(journalPath, journal);
      }
      return { authority_id: executionAuthorityId, status: "CLEANUP_ONLY" };
    },
    recordCleanupOperation: ({ authorityId, ...rest }) =>
      remap(state.recordCleanupOperation({ authorityId: mappedId(authorityId), ...rest })),
    completeCleanup: ({ authorityId, ...rest }) =>
      remap(state.completeCleanup({ authorityId: mappedId(authorityId), ...rest })),
    completeSuccess: ({ authorityId, ...rest }) =>
      remap(state.completeSuccess({ authorityId: mappedId(authorityId), ...rest })),
    async reconcileSuccess({ authorityId }) {
      const value = await state.reconcileSuccess({ authorityId: mappedId(authorityId) });
      return { ...value, authority_id: executionAuthorityId };
    },
    pauseInteractiveChromeLogin: ({ authorityId, ...rest }) =>
      remap(state.pauseInteractiveChromeLogin({ authorityId: mappedId(authorityId), ...rest })),
    resumeInteractiveChromeLogin: ({ authorityId, ...rest }) =>
      remap(state.resumeInteractiveChromeLogin({ authorityId: mappedId(authorityId), ...rest })),
  });
}

function concreteConfigurationIdentity(configuration, protectedInputs) {
  return sha256(
    canonical({
      schema_version: "videoforge.v2-09-concrete-configuration-identity/v1",
      source_commit: configuration.sourceCommit,
      branch: configuration.branch,
      push_ref: configuration.pushRef,
      remote: configuration.remote,
      migration_mode: configuration.migrationMode,
      roles: [configuration.runtimeRole, configuration.operatorRole, configuration.reconcilerRole],
      root_sha256: sha256(resolve(configuration.root)),
      journal_path_sha256: sha256(resolve(configuration.journalPath)),
      protected_input_sha256s: Object.fromEntries(
        PROTECTED_INPUT_NAMES.filter((name) => protectedInputs[name] !== undefined).map((name) => [
          name,
          protectedInputs[name].sha256,
        ]),
      ),
      cloudflare_secret_sha256s: Object.fromEntries(
        Object.entries(protectedInputs.cloudflareSecretFiles).map(([name, input]) => [
          name,
          input.sha256,
        ]),
      ),
      generated_path_sha256s: Object.fromEntries(
        ["mediaReleaseManifestFile", "qualifiedConfigOutputFile", "qualifiedConfigReceiptFile"].map(
          (name) => [name, sha256(resolve(configuration[name]))],
        ),
      ),
      environment_sha256: sha256(canonical(configuration.environment)),
    }),
  );
}

function deriveConcreteAdapterIdentity(portDescriptors, configuration, protectedInputs) {
  if (
    portDescriptors === null ||
    typeof portDescriptors !== "object" ||
    Array.isArray(portDescriptors) ||
    Object.keys(portDescriptors).sort().join(",") !==
      [...REQUIRED_CONCRETE_PORTS].sort().join(",") ||
    REQUIRED_CONCRETE_PORTS.some(
      (name) =>
        (!exactKeys(portDescriptors[name], ["run", "source_sha256"]) &&
          !(
            name === "uploadCloudflareSecrets" &&
            exactKeys(portDescriptors[name], ["run", "secret_input_sha256s", "source_sha256"])
          )) ||
        typeof portDescriptors[name].run !== "function" ||
        !HASH.test(portDescriptors[name].source_sha256 ?? ""),
    )
  )
    fail("V2_09_CONCRETE_PORT_SET_INVALID");
  return sha256(
    canonical({
      schema_version: ADAPTER_IDENTITY_SCHEMA,
      adapter_source_sha256: sha256(readFileSync(SOURCE_PATH)),
      configuration_identity_sha256:
        configuration === null
          ? "TEST_ONLY_UNBOUND"
          : concreteConfigurationIdentity(configuration, protectedInputs),
      direct_dependency_sha256s: Object.fromEntries(
        DIRECT_DEPENDENCY_PATHS.map((path) => [path, sha256(readFileSync(resolve(ROOT, path)))]),
      ),
      port_source_sha256s: Object.fromEntries(
        REQUIRED_CONCRETE_PORTS.map((name) => [name, portDescriptors[name].source_sha256]),
      ),
    }),
  );
}

export function concreteAdapterIdentity(portDescriptors, configuration = null) {
  return deriveConcreteAdapterIdentity(
    portDescriptors,
    configuration,
    configuration === null ? null : protectedInputSnapshot(configuration),
  );
}

async function exactChild(runChild, configuration, command, args, code, options = {}) {
  const result = await runChild({
    command,
    args,
    timeoutMs: options.timeoutMs ?? 10 * 60_000,
    cancellationSignal: options.cancellationSignal,
    timeoutCode: `${code}_TIMEOUT`,
    cancellationCode: `${code}_CANCELLED`,
    executionCode: `${code}_FAILED`,
    options: {
      cwd: configuration.root,
      env: options.env ?? configuration.environment,
      input: options.input,
      maxBuffer: 4 * 1024 * 1024,
    },
  });
  if (result.status !== 0 || result.signal !== null) fail(`V2_09_CONCRETE_${code}_FAILED`);
  return result.stdout.trim();
}

function parseJson(text, code) {
  try {
    return JSON.parse(text);
  } catch {
    fail(`V2_09_CONCRETE_${code}_JSON_INVALID`);
  }
}

function createConcreteQualifiedProductionAdaptersWithPorts(
  configuration,
  {
    ports,
    protectedInputs: suppliedProtectedInputs,
    runChild = runCancellableChildProcess,
    readRunPod = readRunPodEvidence,
    fetchImpl = fetch,
    now = () => new Date(),
    sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
    deploymentOnly = false,
    rehydration = null,
    stagingOnly = false,
  } = {},
) {
  if (
    configuration === null ||
    typeof configuration !== "object" ||
    !COMMIT.test(configuration.sourceCommit ?? "") ||
    configuration.branch !== BRANCH ||
    configuration.pushRef !== PUSH_REF ||
    configuration.remote !== "origin" ||
    !["APPLY_0074_0086", "VERIFY_EXISTING_0086"].includes(configuration.migrationMode) ||
    !ROLE.test(configuration.runtimeRole ?? "") ||
    !ROLE.test(configuration.operatorRole ?? "") ||
    !ROLE.test(configuration.reconcilerRole ?? "") ||
    new Set([configuration.runtimeRole, configuration.operatorRole, configuration.reconcilerRole])
      .size !== 3 ||
    typeof runChild !== "function" ||
    typeof readRunPod !== "function" ||
    typeof fetchImpl !== "function" ||
    typeof now !== "function" ||
    typeof sleep !== "function"
  )
    fail("V2_09_CONCRETE_CONFIGURATION_INVALID");
  for (const path of [
    configuration.journalPath,
    configuration.runpodApiKeyFile,
    configuration.runpodWorkerEnvironmentFile,
    configuration.databaseOwnerUrlFile,
    configuration.databaseOperatorUrlFile,
    configuration.databaseReconcilerUrlFile,
    configuration.chromeRequestFile,
    configuration.chromeAuthStateFile,
    configuration.qualifiedBindingFile,
    configuration.mediaReleaseManifestFile,
    configuration.qualifiedConfigOutputFile,
    configuration.qualifiedConfigReceiptFile,
  ])
    assertPrivateRegularPath(path, {
      mayNotExist:
        path === configuration.journalPath ||
        path === configuration.mediaReleaseManifestFile ||
        path === configuration.qualifiedConfigOutputFile ||
        path === configuration.qualifiedConfigReceiptFile ||
        ((stagingOnly || deploymentOnly) &&
          [configuration.chromeRequestFile, configuration.chromeAuthStateFile].includes(path)),
    });
  if (resolve(configuration.root) !== ROOT) fail("V2_09_CONCRETE_ROOT_INVALID");

  const protectedInputs =
    suppliedProtectedInputs ??
    protectedInputSnapshot(configuration, {
      allowDeferredEndpointSecrets: stagingOnly,
      skipChrome: stagingOnly || deploymentOnly,
    });
  const ownerDatabaseEnvironment = postgresEnvironment(
    configuration,
    protectedInputs.databaseOwnerUrlFile.bytes.toString("utf8"),
  );
  const operatorDatabaseEnvironment = postgresEnvironment(
    configuration,
    protectedInputs.databaseOperatorUrlFile.bytes.toString("utf8"),
  );
  const reconcilerDatabaseEnvironment = postgresEnvironment(
    configuration,
    protectedInputs.databaseReconcilerUrlFile.bytes.toString("utf8"),
  );
  const runtimeDatabaseEnvironment = postgresEnvironment(
    configuration,
    protectedInputs.cloudflareSecretFiles.DATABASE_URL?.bytes.toString("utf8") ?? "",
  );
  const databaseEnvironments = [
    ownerDatabaseEnvironment,
    operatorDatabaseEnvironment,
    reconcilerDatabaseEnvironment,
    runtimeDatabaseEnvironment,
  ];
  const databaseIdentity = (environment) =>
    [
      environment.PGHOST,
      environment.PGPORT,
      environment.PGDATABASE,
      environment.PGSSLMODE,
      environment.PGCHANNELBINDING,
    ].join("\0");
  if (
    operatorDatabaseEnvironment.PGUSER !== configuration.operatorRole ||
    reconcilerDatabaseEnvironment.PGUSER !== configuration.reconcilerRole ||
    runtimeDatabaseEnvironment.PGUSER !== configuration.runtimeRole ||
    new Set(databaseEnvironments.map(({ PGUSER }) => PGUSER)).size !== 4 ||
    new Set(databaseEnvironments.map(databaseIdentity)).size !== 1 ||
    new Set([
      protectedInputs.databaseOwnerUrlFile.sha256,
      protectedInputs.databaseOperatorUrlFile.sha256,
      protectedInputs.databaseReconcilerUrlFile.sha256,
      protectedInputs.cloudflareSecretFiles.DATABASE_URL.sha256,
    ]).size !== 4 ||
    resolve(configuration.cloudflare?.secretFiles?.VIDEOFORGE_RECONCILER_DATABASE_URL ?? "") ===
      resolve(configuration.databaseReconcilerUrlFile) ||
    protectedInputs.cloudflareSecretFiles.VIDEOFORGE_RECONCILER_DATABASE_URL?.sha256 !==
      protectedInputs.databaseReconcilerUrlFile.sha256
  )
    fail("V2_09_CONCRETE_DATABASE_ROLE_BINDING_INVALID");
  const migrationBundle = loadV209MigrationBundle();
  const chromeDocument =
    stagingOnly || deploymentOnly
      ? null
      : validateChromeDocument(configuration, protectedInputs.chromeRequestFile.bytes);
  const assertProtectedInputUnchanged = (name) => {
    const expected = protectedInputs[name];
    const path = configuration[name];
    let descriptor;
    let stat;
    let bytes;
    try {
      descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      stat = fstatSync(descriptor);
      bytes = readFileSync(descriptor);
    } catch {
      fail("V2_09_CONCRETE_PROTECTED_INPUT_DRIFT");
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
    if (
      !stat.isFile() ||
      stat.dev !== expected.dev ||
      stat.ino !== expected.ino ||
      stat.mode !== expected.mode ||
      stat.uid !== expected.uid ||
      stat.nlink !== expected.nlink ||
      stat.size !== expected.size ||
      sha256(bytes) !== expected.sha256
    )
      fail("V2_09_CONCRETE_PROTECTED_INPUT_DRIFT");
  };
  const assertCloudflareSecretInputsUnchanged = () => {
    for (const [name, expected] of Object.entries(protectedInputs.cloudflareSecretFiles)) {
      const path = configuration.cloudflare.secretFiles[name];
      let descriptor;
      let stat;
      let bytes;
      try {
        descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        stat = fstatSync(descriptor);
        bytes = readFileSync(descriptor);
      } catch {
        fail("V2_09_CONCRETE_PROTECTED_INPUT_DRIFT");
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
      if (
        !stat.isFile() ||
        stat.dev !== expected.dev ||
        stat.ino !== expected.ino ||
        stat.mode !== expected.mode ||
        stat.uid !== expected.uid ||
        stat.nlink !== expected.nlink ||
        stat.size !== expected.size ||
        sha256(bytes) !== expected.sha256
      )
        fail("V2_09_CONCRETE_PROTECTED_INPUT_DRIFT");
    }
  };
  const protectedBytes = (name) => {
    assertProtectedInputUnchanged(name);
    return protectedInputs[name].bytes;
  };
  const protectedText = (name) => protectedBytes(name).toString("utf8");
  const postgresEnvironmentFor = (name) => {
    assertProtectedInputUnchanged(name);
    if (name === "databaseOwnerUrlFile") return ownerDatabaseEnvironment;
    if (name === "databaseOperatorUrlFile") return operatorDatabaseEnvironment;
    if (name === "databaseReconcilerUrlFile") return reconcilerDatabaseEnvironment;
    fail("V2_09_CONCRETE_DATABASE_ROLE_BINDING_INVALID");
  };

  const implementationSha256 = deriveConcreteAdapterIdentity(ports, configuration, protectedInputs);
  const providerDeployments = new Map();
  const persistedDeployments = new Map();
  let journalAuthorityId = null;
  if (rehydration !== null) {
    const authority = rehydration?.executionAuthority ?? rehydration?.authority;
    const priorResults = rehydration?.priorResults;
    if (
      authority?.source_commit !== configuration.sourceCommit ||
      priorResults === null ||
      typeof priorResults !== "object" ||
      Array.isArray(priorResults)
    )
      fail("V2_09_CONCRETE_REHYDRATION_INVALID");
    journalAuthorityId =
      rehydration.executionAuthority === undefined
        ? authority.authority_id
        : validateCombinedJournalHandoff(rehydration.combinedExecution, authority, priorResults);
    if (
      rehydration.journalAuthorityId !== undefined &&
      rehydration.journalAuthorityId !== journalAuthorityId
    )
      fail("V2_09_CONCRETE_REHYDRATION_INVALID");
    const journal = readJournal(configuration.journalPath);
    if (
      journal.authority_id !== journalAuthorityId ||
      journal.source_commit !== authority.source_commit ||
      !["CLAIMED", "AWAITING_INTERACTIVE_CHROME_LOGIN"].includes(journal.status)
    )
      fail("V2_09_CONCRETE_REHYDRATION_INVALID");
    const persisted = priorResults["persist-qualified-production-deployments"];
    if (
      persisted?.operation_id !== "persist-qualified-production-deployments" ||
      persisted.persisted_deployment_count !== 2 ||
      !Array.isArray(persisted.deployments) ||
      persisted.deployments.length !== 2
    )
      fail("V2_09_CONCRETE_REHYDRATION_INVALID");
    for (const lane of ["mage", "soulx"]) {
      const operationId = `create-${lane}-production-lane-max-one`;
      const result = priorResults[operationId];
      const deployment = journal.resources[lane];
      const binding = authority.scope?.lanes?.find((entry) => entry.lane === lane);
      const persistedResult = persisted.deployments.find((entry) => entry.lane === lane);
      if (
        journal.normal[operationId]?.status !== "COMPLETED" ||
        journal.normal[operationId].result_sha256 !== sha256(canonical(result)) ||
        journal.normal["persist-qualified-production-deployments"]?.status !== "COMPLETED" ||
        journal.normal["persist-qualified-production-deployments"].result_sha256 !==
          sha256(canonical(persisted)) ||
        binding === undefined ||
        typeof deployment?.endpointId !== "string" ||
        sha256(deployment.endpointId) !== deployment.endpointIdSha256 ||
        typeof deployment.templateId !== "string" ||
        sha256(deployment.templateId) !== deployment.templateIdSha256 ||
        deployment.sourceCommit !== authority.source_commit ||
        deployment.volumeIdSha256 !== binding.volume_id_sha256 ||
        deployment.volumeManifestSha256 !== binding.volume_manifest_sha256 ||
        result?.endpoint_id_sha256 !== deployment.endpointIdSha256 ||
        result?.template_id_sha256 !== deployment.templateIdSha256 ||
        result?.deployment_sha256 !== deployment.deploymentSha256 ||
        persistedResult?.endpoint_id_sha256 !== deployment.endpointIdSha256 ||
        persistedResult?.template_id_sha256 !== deployment.templateIdSha256 ||
        persistedResult?.deployment_sha256 !== deployment.deploymentSha256 ||
        !HASH.test(persistedResult?.deployment_row_id_sha256 ?? "")
      )
        fail("V2_09_CONCRETE_REHYDRATION_INVALID");
      providerDeployments.set(lane, cloneAndFreeze(deployment));
      persistedDeployments.set(
        lane,
        Object.freeze({
          deploymentId: deterministicUuid(`${journalAuthorityId}:deployment:${lane}`),
          deploymentRowIdSha256: persistedResult.deployment_row_id_sha256,
        }),
      );
    }
  }
  let chromeEvidence = null;
  let clickIdentity = null;
  let cleanupState = null;
  let runPodReconciliation = null;
  let terminalJobReconciliation = null;
  const recordProtectedDeployment = (authority, lane, deployment) => {
    const state = readJournal(configuration.journalPath);
    if (state.authority_id !== authority.authority_id || state.status !== "CLAIMED")
      fail("V2_09_CONCRETE_RESOURCE_JOURNAL_INVALID");
    state.resources[lane] = deployment;
    writeFsyncedJson(configuration.journalPath, state);
  };
  const captureClickIdentity = (authority) => {
    const requestSha256 = sha256(canonical(chromeDocument.request));
    const paths = clickIdentityPaths(
      configuration.journalPath,
      authority.authority_id,
      requestSha256,
    );
    const captured = validateClickIdentityStage({ authority, chromeDocument, paths });
    if (captured === null) return null;
    const state = readJournal(configuration.journalPath);
    if (
      state.authority_id !== authority.authority_id ||
      !["CLAIMED", "CLEANUP_ONLY"].includes(state.status)
    )
      fail("V2_09_CONCRETE_RESOURCE_JOURNAL_INVALID");
    if (
      state.resources.chromeClick !== undefined &&
      canonical(state.resources.chromeClick) !== canonical(captured)
    )
      fail("V2_09_CONCRETE_CLICK_IDENTITY_DRIFT");
    state.resources.chromeClick = captured;
    writeFsyncedJson(configuration.journalPath, state);
    clickIdentity = captured;
    return captured;
  };
  const loadClickIdentity = (authority) => {
    const requestSha256 = sha256(canonical(chromeDocument.request));
    const paths = clickIdentityPaths(
      configuration.journalPath,
      authority.authority_id,
      requestSha256,
    );
    const captured = validateClickIdentityStage({ authority, chromeDocument, paths });
    if (captured !== null) return captureClickIdentity(authority);
    if (!existsSync(configuration.journalPath)) return null;
    const state = readJournal(configuration.journalPath);
    if (state.resources.chromeClick !== undefined)
      fail("V2_09_CONCRETE_CLICK_IDENTITY_FILE_MISSING");
    return null;
  };
  const recordStagedClickScope = (authority, receipt) => {
    const scope = cloneAndFreeze({
      schemaVersion: "videoforge.v2-09-staged-click-scope/v1",
      action: receipt.action,
      accountId: chromeDocument.request.accountId,
      workspaceId: chromeDocument.request.workspaceId,
      projectId: receipt.projectId,
      projectRevisionId: receipt.projectRevisionId,
      generationRequestId: receipt.generationRequestId,
    });
    const state = readJournal(configuration.journalPath);
    if (
      state.authority_id !== authority.authority_id ||
      !["CLAIMED", "CLEANUP_ONLY"].includes(state.status)
    )
      fail("V2_09_CONCRETE_RESOURCE_JOURNAL_INVALID");
    const prior = state.resources.stagedClickScope;
    if (
      prior !== undefined &&
      (prior.accountId !== scope.accountId ||
        prior.workspaceId !== scope.workspaceId ||
        (prior.projectId !== null && prior.projectId !== scope.projectId) ||
        (prior.projectRevisionId !== null && prior.projectRevisionId !== scope.projectRevisionId) ||
        (prior.generationRequestId !== null &&
          prior.generationRequestId !== scope.generationRequestId))
    )
      fail("V2_09_CONCRETE_STAGED_CLICK_SCOPE_DRIFT");
    state.resources.stagedClickScope = scope;
    writeFsyncedJson(configuration.journalPath, state);
    return receipt;
  };
  const assertAuthorityConfiguration = (authority) => {
    if (authority?.source_commit !== configuration.sourceCommit)
      fail("V2_09_CONCRETE_AUTHORITY_SOURCE_MISMATCH");
  };
  const readCumulativeRunPodBilling = async () => {
    const checked = now();
    if (!(checked instanceof Date) || !Number.isFinite(checked.getTime()))
      fail("V2_09_CONCRETE_CLOCK_INVALID");
    const billingUrl = new URL("https://rest.runpod.io/v1/billing/endpoints");
    billingUrl.searchParams.set("bucketSize", "hour");
    billingUrl.searchParams.set("grouping", "endpointId");
    billingUrl.searchParams.set("startTime", "2026-08-20T00:00:00.000Z");
    billingUrl.searchParams.set("endTime", checked.toISOString());
    let response;
    try {
      response = await fetchImpl(billingUrl, {
        headers: { authorization: `Bearer ${protectedText("runpodApiKeyFile")}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      fail("V2_09_CONCRETE_BILLING_READ_AMBIGUOUS");
    }
    if (!response.ok) fail("V2_09_CONCRETE_BILLING_READ_FAILED");
    const rows = await response.json();
    if (!Array.isArray(rows)) fail("V2_09_CONCRETE_BILLING_INVALID");
    return rows.reduce((sum, row) => {
      const amount = Number(row?.amount);
      if (!Number.isFinite(amount) || amount < 0) fail("V2_09_CONCRETE_BILLING_INVALID");
      return sum + amount;
    }, 0);
  };
  const operations = {};
  operations["push-clean-source"] = async ({ authority }) => {
    assertAuthorityConfiguration(authority);
    const status = await exactChild(
      runChild,
      configuration,
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      "SOURCE_STATUS",
    );
    if (status !== "") fail("V2_09_CONCRETE_SOURCE_NOT_CLEAN");
    const head = await exactChild(
      runChild,
      configuration,
      "git",
      ["rev-parse", "HEAD"],
      "SOURCE_HEAD",
    );
    if (head !== authority.source_commit) fail("V2_09_CONCRETE_SOURCE_HEAD_DRIFT");
    await exactChild(
      runChild,
      configuration,
      "git",
      ["push", "--porcelain", "origin", `${authority.source_commit}:${PUSH_REF}`],
      "SOURCE_PUSH",
    );
    return {
      operation_id: "push-clean-source",
      source_commit: authority.source_commit,
      destination_ref: PUSH_REF,
      push_count: 1,
    };
  };
  operations["readback-clean-source"] = async ({ authority }) => {
    assertAuthorityConfiguration(authority);
    const output = await exactChild(
      runChild,
      configuration,
      "git",
      ["ls-remote", "--heads", "origin", PUSH_REF],
      "SOURCE_READBACK",
    );
    const [commit, ref, ...extra] = output.split(/\s+/u);
    if (extra.length !== 0 || commit !== authority.source_commit || ref !== PUSH_REF)
      fail("V2_09_CONCRETE_SOURCE_READBACK_DRIFT");
    return { operation_id: "readback-clean-source", source_commit: commit, destination_ref: ref };
  };
  operations["apply-migrations-0074-0086"] = async ({ operation }) => {
    const verifyExisting = configuration.migrationMode === "VERIFY_EXISTING_0086";
    const output = await exactChild(
      runChild,
      configuration,
      "psql",
      ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--quiet", "--tuples-only", "--no-align"],
      "MIGRATIONS",
      {
        cancellationSignal: operation.cancellationSignal,
        env: postgresEnvironmentFor("databaseOwnerUrlFile"),
        input: renderV209MigrationSql(migrationBundle, verifyExisting),
      },
    );
    const receipt = parseJson(output, "MIGRATIONS");
    if (
      !exactKeys(receipt, ["fromVersion", "mode", "schemaVersion", "toVersion"]) ||
      receipt.schemaVersion !== "videoforge.v2-09-migration-result/v1" ||
      receipt.mode !== (verifyExisting ? "VERIFIED_EXISTING_0086" : "APPLIED_0074_0086") ||
      receipt.fromVersion !== (verifyExisting ? 86 : 73) ||
      receipt.toVersion !== 86
    )
      fail("V2_09_CONCRETE_MIGRATION_RECEIPT_INVALID");
    return verifyExisting
      ? {
          operation_id: "apply-migrations-0074-0086",
          mode: "VERIFIED_EXISTING_0086",
          from_version: 86,
          to_version: 86,
          applied_versions: [],
        }
      : {
          operation_id: "apply-migrations-0074-0086",
          mode: "APPLIED_0074_0086",
          from_version: 73,
          to_version: 86,
          applied_versions: [74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86],
        };
  };
  operations["apply-v209-grants"] = async () => {
    const roleArgs = [
      "--variable",
      `operator_role=${configuration.operatorRole}`,
      "--variable",
      `runtime_role=${configuration.runtimeRole}`,
      "--variable",
      `reconciler_role=${configuration.reconcilerRole}`,
    ];
    for (const file of [
      "deploy/v2-09/neon-v209-runtime-grants.sql",
      "deploy/v2-09/neon-qualified-activation-operator-grants.sql",
      "deploy/v2-09/neon-pair-reconciler-grants.sql",
    ])
      await exactChild(
        runChild,
        configuration,
        "psql",
        ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", ...roleArgs, "--file", resolve(ROOT, file)],
        "V209_GRANTS",
        { env: postgresEnvironmentFor("databaseOwnerUrlFile") },
      );
    return {
      schema_version: "videoforge.v2-09-grants-result/v1",
      operation_id: "apply-v209-grants",
      migration_head: 86,
      public_execute_count: 0,
      runtime_grants_verified: true,
      operator_grants_verified: true,
      reconciler_grants_verified: true,
    };
  };
  operations["fresh-read-only-admission"] = async ({ authority }) => {
    assertAuthorityConfiguration(authority);
    const apiKey = protectedText("runpodApiKeyFile");
    if (
      apiKey.trim() !== apiKey ||
      apiKey.length < 20 ||
      apiKey.length > 4096 ||
      apiKey.includes("\0")
    )
      fail("V2_09_CONCRETE_RUNPOD_KEY_INVALID");
    const observed = now();
    if (!(observed instanceof Date) || !Number.isFinite(observed.getTime()))
      fail("V2_09_CONCRETE_CLOCK_INVALID");
    const checkedAt = observed.toISOString();
    const runpod = await readRunPod({ apiKey, fetchImpl, checkedAt });
    const validated = now();
    if (!(validated instanceof Date) || !Number.isFinite(validated.getTime()))
      fail("V2_09_CONCRETE_CLOCK_INVALID");
    return {
      schema_version: "videoforge.v2-09-rollout-admission/v1",
      operation_id: "fresh-read-only-admission",
      billing_baseline_usd: runpod.billing.cumulativeEndpointBillingUsd,
      completion_baseline_usd: authority.caps.completion_baseline_usd,
      projected_incremental_usd: authority.caps.incremental_cap_usd,
      projected_completion_usd: authority.caps.completion_stop_usd,
      offering_id_sha256: authority.offering.offering_id_sha256,
      catalog_snapshot_sha256: runpod.offering.catalogSha256,
      observed_at: checkedAt,
      validated_at: validated.toISOString(),
      gpu: runpod.offering.gpu,
      region: runpod.offering.region,
      availability: runpod.offering.availability,
      rate_usd_per_gpu_hour: runpod.offering.serverlessFlexRateUsdPerGpuHour,
      zero_compute: true,
      retained_volume_count: runpod.inventory.retainedVolumes.length,
      workers_min: 0,
      workers_max: 1,
    };
  };
  for (const laneName of ["mage", "soulx"]) {
    const operationId = `create-${laneName}-production-lane-max-one`;
    operations[operationId] = async ({ authority, operation }) => {
      assertAuthorityConfiguration(authority);
      const apiKey = protectedText("runpodApiKeyFile");
      const workerEnvironment = parseJson(
        protectedText("runpodWorkerEnvironmentFile"),
        "RUNPOD_WORKER_ENVIRONMENT",
      );
      const output = await exactChild(
        runChild,
        configuration,
        "pnpm",
        [
          "--filter",
          "@videoforge/web",
          "exec",
          "tsx",
          resolve(ROOT, "deploy/v2-09/v209-runpod-production-bridge.ts"),
        ],
        "RUNPOD_PRODUCTION_LANE",
        {
          cancellationSignal: operation.cancellationSignal,
          input: `${canonical({
            schema_version: "videoforge.v2-09-runpod-production-bridge/v1",
            command: "CREATE_OR_READ_LANE",
            authority_id: authority.authority_id,
            source_commit: authority.source_commit,
            api_key: apiKey,
            lane: laneName,
            lanes: authority.scope.lanes.map((lane) => ({
              lane: lane.lane,
              image_sha256: lane.image_sha256,
              image_source_commit: lane.image_source_commit,
              image_config_sha256: lane.image_config_sha256,
              anonymous_proof_sha256: lane.anonymous_proof_sha256,
              acceptance_sha256: lane.acceptance_sha256,
              volume_id_sha256: lane.volume_id_sha256,
              volume_manifest_sha256: lane.volume_manifest_sha256,
            })),
            worker_environment: workerEnvironment,
          })}\n`,
        },
      );
      const value = parseJson(output, "RUNPOD_PRODUCTION_LANE");
      const deployment = value?.deployment;
      const binding = authority.scope.lanes.find(({ lane }) => lane === laneName);
      const publicImage =
        laneName === "mage"
          ? `ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@${binding.image_sha256}`
          : `ghcr.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@${binding.image_sha256}`;
      if (
        value?.schema_version !== "videoforge.v2-09-runpod-production-bridge-result/v1" ||
        deployment?.lane !== laneName ||
        deployment?.purpose !== "production" ||
        deployment?.image !== publicImage ||
        deployment?.sourceCommit !== authority.source_commit ||
        deployment?.volumeIdSha256 !== binding.volume_id_sha256 ||
        deployment?.volumeManifestSha256 !== binding.volume_manifest_sha256 ||
        deployment?.volumeSizeGb !== 50 ||
        deployment?.volumeMount !== "/runpod-volume" ||
        deployment?.region !== "EU-RO-1" ||
        deployment?.gpu !== "NVIDIA GeForce RTX 4090" ||
        deployment?.gpuCount !== 1 ||
        deployment?.workersMin !== 0 ||
        deployment?.workersMax !== 1 ||
        deployment?.handlerConcurrency !== 1 ||
        !HASH.test(deployment?.endpointIdSha256 ?? "") ||
        !HASH.test(deployment?.templateIdSha256 ?? "") ||
        !HASH.test(deployment?.deploymentSha256 ?? "")
      )
        fail("V2_09_CONCRETE_RUNPOD_PRODUCTION_LANE_INVALID");
      providerDeployments.set(laneName, deployment);
      recordProtectedDeployment(authority, laneName, deployment);
      return {
        schema_version: "videoforge.v2-09-production-lane-result/v1",
        operation_id: operationId,
        lane: laneName,
        gpu: binding.gpu,
        region: binding.region,
        workers_min: binding.workers_min,
        workers_max: binding.workers_max,
        handler_concurrency: binding.handler_concurrency,
        retained_volume_size_gb: binding.volume_size_gb,
        image_sha256: binding.image_sha256,
        image_source_commit: binding.image_source_commit,
        image_config_sha256: binding.image_config_sha256,
        anonymous_proof_sha256: binding.anonymous_proof_sha256,
        acceptance_sha256: binding.acceptance_sha256,
        volume_id_sha256: binding.volume_id_sha256,
        volume_manifest_sha256: binding.volume_manifest_sha256,
        endpoint_id_sha256: deployment.endpointIdSha256,
        template_id_sha256: deployment.templateIdSha256,
        deployment_sha256: deployment.deploymentSha256,
      };
    };
  }
  operations["persist-qualified-production-deployments"] = async ({ authority, operation }) => {
    assertAuthorityConfiguration(authority);
    const rows = ["mage", "soulx"].map((lane) => {
      const deployment = providerDeployments.get(lane);
      const binding = authority.scope.lanes.find((item) => item.lane === lane);
      if (
        deployment === undefined ||
        binding === undefined ||
        typeof deployment.endpointId !== "string" ||
        typeof deployment.templateId !== "string"
      )
        fail("V2_09_CONCRETE_PRODUCTION_PAIR_NOT_CREATED");
      return {
        deploymentId: deterministicUuid(`${authority.authority_id}:deployment:${lane}`),
        deploymentSha256: deployment.deploymentSha256,
        endpointId: deployment.endpointId,
        endpointIdSha256: deployment.endpointIdSha256,
        imageSha256: binding.image_sha256,
        lane: lane === "mage" ? "mage_image" : "soulx_avatar",
        sourceCommit: authority.source_commit,
        templateId: deployment.templateId,
        templateIdSha256: deployment.templateIdSha256,
        volumeIdSha256: binding.volume_id_sha256,
        volumeManifestSha256: binding.volume_manifest_sha256,
      };
    });
    const payload = {
      schemaVersion: "videoforge.v2-09-qualified-production-persistence/v1",
      sourceCommit: authority.source_commit,
      rows,
    };
    const output = await exactChild(
      runChild,
      configuration,
      "psql",
      [
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--quiet",
        "--tuples-only",
        "--no-align",
        "--variable",
        `payload_base64=${Buffer.from(canonical(payload), "utf8").toString("base64")}`,
        "--file",
        resolve(ROOT, "deploy/v2-09/neon-persist-qualified-production.sql"),
      ],
      "PERSIST_PRODUCTION_PAIR",
      {
        cancellationSignal: operation.cancellationSignal,
        env: postgresEnvironmentFor("databaseOwnerUrlFile"),
      },
    );
    const readback = parseJson(output, "PERSIST_PRODUCTION_PAIR");
    if (
      readback?.schemaVersion !== "videoforge.v2-09-qualified-production-persistence-result/v1" ||
      !Array.isArray(readback.rows) ||
      readback.rows.length !== 2
    )
      fail("V2_09_CONCRETE_PRODUCTION_PAIR_PERSISTENCE_INVALID");
    for (const [index, lane] of ["mage", "soulx"].entries()) {
      const result = readback.rows[index];
      const expected = rows[index];
      if (
        result?.lane !== lane ||
        result?.deploymentId !== expected.deploymentId ||
        result?.deploymentSha256 !== expected.deploymentSha256 ||
        result?.endpointIdSha256 !== expected.endpointIdSha256 ||
        result?.templateIdSha256 !== expected.templateIdSha256 ||
        !HASH.test(result?.deploymentRowIdSha256 ?? "")
      )
        fail("V2_09_CONCRETE_PRODUCTION_PAIR_PERSISTENCE_INVALID");
      persistedDeployments.set(lane, {
        deploymentId: result.deploymentId,
        deploymentRowIdSha256: result.deploymentRowIdSha256,
      });
    }
    return {
      schema_version: "videoforge.v2-09-deployment-persistence-result/v1",
      operation_id: "persist-qualified-production-deployments",
      persisted_deployment_count: 2,
      deployments: ["mage", "soulx"].map((lane) => {
        const deployment = providerDeployments.get(lane);
        const persisted = persistedDeployments.get(lane);
        return {
          lane,
          deployment_sha256: deployment.deploymentSha256,
          endpoint_id_sha256: deployment.endpointIdSha256,
          template_id_sha256: deployment.templateIdSha256,
          deployment_row_id_sha256: persisted.deploymentRowIdSha256,
        };
      }),
    };
  };
  operations["render-qualified-production-config"] = async ({
    authority,
    priorResults = Object.freeze([]),
    receiptBindingMode = "STATIC_AUTHORITY",
  }) => {
    assertAuthorityConfiguration(authority);
    if (!["STATIC_AUTHORITY", "STAGED_OBSERVED"].includes(receiptBindingMode))
      fail("V2_09_CONCRETE_RENDER_CONFIG_BINDING_MODE_INVALID");
    if (
      receiptBindingMode === "STAGED_OBSERVED" &&
      authority?.execution !== "V2_09_PREFLIGHT_THEN_QUALIFIED_PRODUCTION_ONCE"
    )
      fail("V2_09_CONCRETE_RENDER_CONFIG_BINDING_MODE_INVALID");
    assertProtectedInputUnchanged("qualifiedBindingFile");
    const manifestBytes = readPrivateBytesOnce(configuration.mediaReleaseManifestFile);
    if (sha256(manifestBytes) !== authority.media_worker?.release_manifest_sha256)
      fail("V2_09_CONCRETE_MEDIA_RELEASE_MANIFEST_DRIFT");
    let bindingBytes = protectedInputs.qualifiedBindingFile.bytes;
    let observedEndpoints = null;
    if (receiptBindingMode === "STAGED_OBSERVED") {
      if (!Array.isArray(priorResults)) fail("V2_09_CONCRETE_STAGED_BINDING_INPUT_INVALID");
      const resultById = new Map();
      for (const entry of priorResults) {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== "string" ||
          resultById.has(entry[0])
        )
          fail("V2_09_CONCRETE_STAGED_BINDING_INPUT_INVALID");
        resultById.set(entry[0], entry[1]);
      }
      const laneResults = ["mage", "soulx"].map((lane) => {
        const operationId = `create-${lane}-production-lane-max-one`;
        const result = resultById.get(operationId);
        const expected = authority.scope?.lanes?.find((item) => item.lane === lane);
        if (
          !exactKeys(result, [
            "acceptance_sha256",
            "anonymous_proof_sha256",
            "deployment_sha256",
            "endpoint_id_sha256",
            "gpu",
            "handler_concurrency",
            "image_config_sha256",
            "image_sha256",
            "image_source_commit",
            "lane",
            "operation_id",
            "region",
            "retained_volume_size_gb",
            "schema_version",
            "template_id_sha256",
            "volume_id_sha256",
            "volume_manifest_sha256",
            "workers_max",
            "workers_min",
          ]) ||
          result?.schema_version !== "videoforge.v2-09-production-lane-result/v1" ||
          result.operation_id !== operationId ||
          result.lane !== lane ||
          expected === undefined ||
          result.image_sha256 !== expected.image_sha256 ||
          result.image_source_commit !== expected.image_source_commit ||
          result.image_config_sha256 !== expected.image_config_sha256 ||
          result.anonymous_proof_sha256 !== expected.anonymous_proof_sha256 ||
          result.acceptance_sha256 !== expected.acceptance_sha256 ||
          result.volume_id_sha256 !== expected.volume_id_sha256 ||
          result.volume_manifest_sha256 !== expected.volume_manifest_sha256 ||
          result.gpu !== expected.gpu ||
          result.region !== expected.region ||
          result.workers_min !== expected.workers_min ||
          result.workers_max !== expected.workers_max ||
          result.handler_concurrency !== expected.handler_concurrency ||
          result.retained_volume_size_gb !== expected.volume_size_gb ||
          !HASH.test(result.endpoint_id_sha256 ?? "") ||
          /^sha256:0{64}$/u.test(result.endpoint_id_sha256) ||
          !HASH.test(result.template_id_sha256 ?? "") ||
          !HASH.test(result.deployment_sha256 ?? "")
        )
          fail("V2_09_CONCRETE_STAGED_BINDING_INPUT_INVALID");
        return result;
      });
      const persisted = resultById.get("persist-qualified-production-deployments");
      if (
        !exactKeys(persisted, [
          "deployments",
          "operation_id",
          "persisted_deployment_count",
          "schema_version",
        ]) ||
        persisted?.schema_version !== "videoforge.v2-09-deployment-persistence-result/v1" ||
        persisted.operation_id !== "persist-qualified-production-deployments" ||
        persisted.persisted_deployment_count !== 2 ||
        !Array.isArray(persisted.deployments) ||
        persisted.deployments.length !== 2 ||
        persisted.deployments.some(
          (deployment, index) =>
            !exactKeys(deployment, [
              "deployment_row_id_sha256",
              "deployment_sha256",
              "endpoint_id_sha256",
              "lane",
              "template_id_sha256",
            ]) ||
            deployment?.lane !== laneResults[index].lane ||
            deployment.endpoint_id_sha256 !== laneResults[index].endpoint_id_sha256 ||
            deployment.template_id_sha256 !== laneResults[index].template_id_sha256 ||
            deployment.deployment_sha256 !== laneResults[index].deployment_sha256 ||
            !HASH.test(deployment.deployment_row_id_sha256 ?? ""),
        )
      )
        fail("V2_09_CONCRETE_STAGED_BINDING_INPUT_INVALID");
      const template = parseJson(
        protectedInputs.qualifiedBindingFile.bytes.toString("utf8"),
        "STAGED_BINDING_TEMPLATE",
      );
      const binding = {
        schema_version: "videoforge-v2-09-qualified-production-config-preparation/v1",
        authority: {
          mode: "PROVIDER_FREE_CONFIG_PREPARATION",
          credential_access_authorized: false,
          deployment_authorized: false,
          provider_calls_authorized: false,
          external_spend_usd: 0,
        },
        release: {
          source_commit: authority.source_commit,
          media_worker_release_manifest_sha256: sha256(manifestBytes),
        },
        production: template?.production,
        lanes: {
          mage_image: {
            qualification_record_sha256: laneResults[0].acceptance_sha256,
            worker_image_digest: laneResults[0].image_sha256,
            endpoint_id_sha256: laneResults[0].endpoint_id_sha256,
          },
          soulx_avatar: {
            qualification_record_sha256: laneResults[1].acceptance_sha256,
            worker_image_digest: laneResults[1].image_sha256,
            endpoint_id_sha256: laneResults[1].endpoint_id_sha256,
          },
        },
      };
      validatePreparationBinding(binding);
      bindingBytes = Buffer.from(`${canonical(binding)}\n`, "utf8");
      observedEndpoints = laneResults.map(({ endpoint_id_sha256 }) => endpoint_id_sha256);
    }
    const bindingSnapshotPath = materializeSealedInput(
      configuration.journalPath,
      receiptBindingMode === "STAGED_OBSERVED"
        ? "qualified-binding-staged-observed"
        : "qualified-binding",
      bindingBytes,
    );
    const output = await exactChild(
      runChild,
      configuration,
      process.execPath,
      [
        resolve(ROOT, "deploy/v2-09/render-qualified-production-config.mjs"),
        "--binding",
        bindingSnapshotPath,
        "--release-manifest",
        configuration.mediaReleaseManifestFile,
        "--output",
        configuration.qualifiedConfigOutputFile,
        "--receipt-output",
        configuration.qualifiedConfigReceiptFile,
      ],
      "RENDER_CONFIG",
    );
    assertProtectedInputUnchanged("qualifiedBindingFile");
    const receipt = parseJson(output, "RENDER_CONFIG");
    if (
      receipt.schema_version !==
        "videoforge-v2-09-qualified-production-config-preparation-receipt/v1" ||
      receipt.source_commit !== authority.source_commit ||
      receipt.binding_sha256 !== sha256(bindingBytes) ||
      !HASH.test(receipt.config_sha256 ?? "") ||
      !HASH.test(receipt.worker_bundle_sha256 ?? "") ||
      receipt.media_worker_release?.version !== authority.media_worker.release ||
      receipt.media_worker_release?.manifest_sha256 !==
        authority.media_worker.release_manifest_sha256 ||
      receipt.gpu_transport !== "QUALIFIED_EXACT" ||
      receipt.production_build_verified !== true ||
      receipt.wrangler_dry_run_succeeded !== true ||
      receipt.deployment_attempted !== false ||
      receipt.provider_calls !== 0 ||
      receipt.external_spend_usd !== 0
    )
      fail("V2_09_CONCRETE_RENDER_CONFIG_DRIFT");
    if (
      observedEndpoints !== null &&
      (receipt.lanes?.mage_image?.endpoint_id_sha256 !== observedEndpoints[0] ||
        receipt.lanes?.soulx_avatar?.endpoint_id_sha256 !== observedEndpoints[1])
    )
      fail("V2_09_CONCRETE_RENDER_CONFIG_DRIFT");
    if (
      receiptBindingMode === "STATIC_AUTHORITY" &&
      (receipt.config_sha256 !== authority.production?.config_sha256 ||
        receipt.worker_bundle_sha256 !== authority.production?.worker_bundle_sha256)
    )
      fail("V2_09_CONCRETE_RENDER_CONFIG_DRIFT");
    return {
      operation_id: "render-qualified-production-config",
      config_sha256: receipt.config_sha256,
      worker_bundle_sha256: receipt.worker_bundle_sha256,
    };
  };
  operations["import-v209-qualified-activation"] = async ({
    authority,
    operation,
    priorResults,
  }) => {
    assertAuthorityConfiguration(authority);
    const cloudflare = priorResults.find(
      ([operationId]) => operationId === "readback-qualified-production",
    )?.[1];
    const observed = now();
    if (
      !(observed instanceof Date) ||
      !Number.isFinite(observed.getTime()) ||
      !HASH.test(cloudflare?.deployment_id_sha256 ?? "") ||
      !HASH.test(cloudflare?.config_sha256 ?? "") ||
      persistedDeployments.size !== 2 ||
      providerDeployments.size !== 2
    )
      fail("V2_09_CONCRETE_ACTIVATION_INPUT_INVALID");
    const laneDocument = (lane) => {
      const binding = authority.scope.lanes.find((item) => item.lane === lane);
      const persisted = persistedDeployments.get(lane);
      const deployment = providerDeployments.get(lane);
      return {
        acceptanceArtifactSha256: binding.acceptance_sha256,
        anonymousProofSha256: binding.anonymous_proof_sha256,
        deploymentId: persisted.deploymentId,
        deploymentReadbackSha256: sha256(canonical(deployment)),
        imageConfigSha256: binding.image_config_sha256,
        imageSourceCommit: binding.image_source_commit,
        qualificationId: deterministicUuid(`${authority.authority_id}:qualification:${lane}`),
      };
    };
    const activationId = deterministicUuid(`${authority.authority_id}:activation`);
    const activation = {
      activationId,
      cloudflareVersionIdSha256: cloudflare.deployment_id_sha256,
      deployedConfigSha256: authority.production.config_sha256,
      lanes: {
        mage_image: laneDocument("mage"),
        soulx_avatar: laneDocument("soulx"),
      },
      observedAt: observed.toISOString(),
      readbackSha256: sha256(canonical(cloudflare)),
      schemaVersion: "videoforge.hosted-v209-qualified-activation-import/v1",
      sourceCommit: authority.source_commit,
    };
    const output = await exactChild(
      runChild,
      configuration,
      "psql",
      [
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--quiet",
        "--tuples-only",
        "--no-align",
        "--variable",
        `payload_base64=${Buffer.from(canonical(activation), "utf8").toString("base64")}`,
        "--file",
        resolve(ROOT, "deploy/v2-09/neon-import-qualified-activation.sql"),
      ],
      "IMPORT_QUALIFIED_ACTIVATION",
      {
        cancellationSignal: operation.cancellationSignal,
        env: postgresEnvironmentFor("databaseOperatorUrlFile"),
      },
    );
    const readback = parseJson(output, "IMPORT_QUALIFIED_ACTIVATION");
    if (
      readback?.imported?.schemaVersion !==
        "videoforge.hosted-v209-qualified-activation-result/v1" ||
      readback.imported.activationId !== activationId ||
      readback.imported.replayed !== false ||
      !HASH.test(readback.imported.evidenceSha256 ?? "") ||
      readback.loaded?.verification?.accepted !== true ||
      readback.loaded?.verification?.signatureVerified !== true ||
      readback.loaded?.verification?.sourceCommit !== authority.source_commit ||
      readback.loaded?.evidence?.deployedConfigSha256 !== authority.production.config_sha256 ||
      readback.loaded?.evidence?.cloudflareVersionIdSha256 !== cloudflare.deployment_id_sha256
    )
      fail("V2_09_CONCRETE_ACTIVATION_READBACK_INVALID");
    return {
      schema_version: "videoforge.v2-09-activation-import-result/v1",
      operation_id: "import-v209-qualified-activation",
      import_count: 1,
      qualified_activation_active: true,
      source_commit: authority.source_commit,
      config_sha256: authority.production.config_sha256,
      worker_bundle_sha256: authority.production.worker_bundle_sha256,
      cloudflare_deployment_id_sha256: cloudflare.deployment_id_sha256,
      deployment_row_id_sha256s: ["mage", "soulx"].map(
        (lane) => persistedDeployments.get(lane).deploymentRowIdSha256,
      ),
    };
  };
  const readGenericProjectRevisionNetCost = async (projectRevisionId, operation = {}) => {
    if (!UUID.test(projectRevisionId ?? "")) fail("V2_09_CONCRETE_E2E_COST_SCOPE_INVALID");
    const output = await exactChild(
      runChild,
      configuration,
      "psql",
      [
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--quiet",
        "--tuples-only",
        "--no-align",
        "--variable",
        `payload_base64=${Buffer.from(
          canonical({
            accountId: chromeDocument.request.accountId,
            workspaceId: chromeDocument.request.workspaceId,
            projectRevisionId,
          }),
          "utf8",
        ).toString("base64")}`,
        "--file",
        resolve(ROOT, "deploy/v2-09/neon-read-v209-e2e-cost.sql"),
      ],
      "E2E_COST_READBACK",
      {
        cancellationSignal: operation.cancellationSignal,
        env: postgresEnvironmentFor("databaseReconcilerUrlFile"),
      },
    );
    const cost = parseJson(output, "E2E_COST_READBACK");
    if (
      cost?.schemaVersion !== "videoforge.v2-09-e2e-cost-readback/v1" ||
      cost.projectRevisionId !== projectRevisionId ||
      !Number.isSafeInteger(cost.genericProjectRevisionNetCostMicroUsd) ||
      cost.genericProjectRevisionNetCostMicroUsd < 0 ||
      cost.genericProjectRevisionNetCostMicroUsd > 2_000_000
    )
      fail("V2_09_CONCRETE_E2E_COST_INVALID");
    return cost.genericProjectRevisionNetCostMicroUsd;
  };
  operations["run-one-v209-chrome-e2e"] = async ({ authority, operation }) => {
    assertAuthorityConfiguration(authority);
    const requestBytes = protectedBytes("chromeRequestFile");
    const authBytes = protectedBytes("chromeAuthStateFile");
    if (
      sha256(requestBytes) !== authority.production.chrome_request_sha256 ||
      sha256(authBytes) !== authority.production.chrome_auth_state_sha256
    )
      fail("V2_09_CONCRETE_CHROME_INPUT_HASH_DRIFT");
    const document = chromeDocument;
    const authSnapshotPath = materializeSealedInput(
      configuration.journalPath,
      "chrome-auth",
      authBytes,
    );
    const requestSha256 = sha256(canonical(document.request));
    const clickPaths = clickIdentityPaths(
      configuration.journalPath,
      authority.authority_id,
      requestSha256,
    );
    if ([clickPaths.base, clickPaths.claim, clickPaths.create, clickPaths.project].some(existsSync))
      fail("V2_09_CONCRETE_CLICK_IDENTITY_ALREADY_EXISTS");
    const startedAt = now();
    const startedAtMs = startedAt instanceof Date ? startedAt.getTime() : Number.NaN;
    const authorityExpiresAt = Date.parse(authority.expires_at);
    const deadlineAt = Math.min(Date.parse(document.request.stopAt), authorityExpiresAt);
    const remainingMs = deadlineAt - startedAtMs;
    if (
      !Number.isFinite(startedAtMs) ||
      !Number.isFinite(authorityExpiresAt) ||
      !Number.isFinite(deadlineAt) ||
      remainingMs < 800_000 ||
      remainingMs > 1_800_000
    )
      fail("V2_09_CONCRETE_CHROME_DEADLINE_INVALID");
    let output;
    try {
      output = await exactChild(
        runChild,
        configuration,
        "pnpm",
        [
          "--filter",
          "@videoforge/web",
          "exec",
          "tsx",
          resolve(ROOT, "deploy/v2-09/v209-real-chrome-bridge.ts"),
        ],
        "REAL_CHROME_E2E",
        {
          cancellationSignal: operation.cancellationSignal,
          timeoutMs: remainingMs,
          input: `${canonical({
            schemaVersion: "videoforge.v2-09-real-chrome-bridge/v1",
            authorityId: authority.authority_id,
            request: document.request,
            productionOrigin: document.productionOrigin,
            authStatePath: authSnapshotPath,
            clickIdentityPath: clickPaths.base,
            voiceoverPath: document.voiceoverPath,
            verifiedOutputPath: document.verifiedOutputPath,
          })}\n`,
        },
      );
    } catch (error) {
      captureClickIdentity(authority);
      throw error;
    }
    const capturedClick = captureClickIdentity(authority);
    const bridge = parseJson(output, "REAL_CHROME_E2E");
    const evidence = bridge?.evidence;
    if (
      bridge?.schema_version !== "videoforge.v2-09-real-chrome-bridge-result/v1" ||
      evidence?.schemaVersion !== "videoforge.v2-09-real-chrome-operator-evidence/v1" ||
      evidence?.browser !== "chrome" ||
      evidence?.source !== "HOSTED_V209_ORDINARY" ||
      evidence?.generateClickCount !== 1 ||
      capturedClick?.stage !== "GENERATION_CREATED" ||
      capturedClick.identity.projectId !== evidence?.projectId ||
      capturedClick.identity.projectRevisionId !== evidence?.projectRevisionId ||
      capturedClick.identity.generationRequestId !== evidence?.generationRequestId ||
      !Number.isFinite(evidence?.durationSeconds) ||
      evidence.durationSeconds < 30 ||
      evidence.durationSeconds > 60 ||
      !HASH.test(evidence?.outputSha256 ?? "")
    )
      fail("V2_09_CONCRETE_CHROME_EVIDENCE_INVALID");
    const chromeVersion = await exactChild(
      runChild,
      configuration,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ["--version"],
      "CHROME_VERSION",
      { cancellationSignal: operation.cancellationSignal },
    );
    if (!/^Google Chrome \d+(?:\.\d+){3}$/u.test(chromeVersion))
      fail("V2_09_CONCRETE_CHROME_VERSION_INVALID");
    const genericProjectRevisionNetCostMicroUsd = await readGenericProjectRevisionNetCost(
      evidence.projectRevisionId,
      operation,
    );
    assertProtectedInputUnchanged("chromeRequestFile");
    assertProtectedInputUnchanged("chromeAuthStateFile");
    if (sha256(readPrivateBytesOnce(authSnapshotPath)) !== sha256(authBytes))
      fail("V2_09_CONCRETE_SEALED_INPUT_DRIFT");
    const postDeployment = await invokeRunPodReconciliation(
      authority,
      operation,
      "READ_INVENTORY",
      { deployments: [], jobs: [] },
    );
    const expectedEndpointIds = ["mage", "soulx"]
      .map((lane) => providerDeployments.get(lane)?.endpointIdSha256)
      .sort();
    const observedEndpointIds = [...postDeployment.inventory.endpointIdSha256s].sort();
    if (
      expectedEndpointIds.length !== 2 ||
      expectedEndpointIds.some((id) => !HASH.test(id ?? "")) ||
      JSON.stringify(observedEndpointIds) !== JSON.stringify(expectedEndpointIds) ||
      postDeployment.inventory.activeWorkers !== 0 ||
      postDeployment.inventory.runningPods !== 0 ||
      postDeployment.inventory.queuedJobs !== 0 ||
      postDeployment.inventory.volumes.length !== 2 ||
      authority.scope.lanes.some((lane) => {
        const volume = postDeployment.inventory.volumes.find(
          ({ idSha256 }) => idSha256 === lane.volume_id_sha256,
        );
        return (
          !volume ||
          volume.sizeGb !== lane.volume_size_gb ||
          volume.region !== lane.region ||
          volume.manifestSha256 !== lane.volume_manifest_sha256
        );
      })
    )
      fail("V2_09_CONCRETE_POST_DEPLOYMENT_INVENTORY_INVALID");
    runPodReconciliation = postDeployment;
    const billingTotal = await readCumulativeRunPodBilling();
    chromeEvidence = Object.freeze({ evidence, document });
    return {
      schema_version: "videoforge.v2-09-one-chrome-e2e-result/v1",
      operation_id: "run-one-v209-chrome-e2e",
      submission_count: 1,
      redispatch_count: 0,
      project_id_sha256: sha256(evidence.projectId),
      generation_request_sha256: sha256(evidence.generationRequestId),
      output_id_sha256: sha256(evidence.outputId),
      mp4_sha256: evidence.outputSha256,
      browser_evidence_sha256: sha256(canonical(evidence)),
      chrome_version_sha256: sha256(chromeVersion),
      duration_seconds: evidence.durationSeconds,
      playback_verified: true,
      seek_verified: true,
      download_verified: true,
      billing_total_usd: billingTotal,
      completion_total_usd:
        authority.caps.completion_baseline_usd + genericProjectRevisionNetCostMicroUsd / 1_000_000,
      generic_project_revision_net_cost_usd: genericProjectRevisionNetCostMicroUsd / 1_000_000,
    };
  };
  operations["verify-private-mp4-lineage"] = async ({ authority, operation }) => {
    assertAuthorityConfiguration(authority);
    if (chromeEvidence === null) fail("V2_09_CONCRETE_CHROME_EVIDENCE_UNAVAILABLE");
    const { evidence, document } = chromeEvidence;
    assertPrivateRegularPath(document.verifiedOutputPath);
    const mp4Bytes = readFileSync(document.verifiedOutputPath);
    if (sha256(mp4Bytes) !== evidence.outputSha256) fail("V2_09_CONCRETE_PRIVATE_MP4_HASH_DRIFT");
    const output = await exactChild(
      runChild,
      configuration,
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name",
        "-of",
        "json",
        "pipe:0",
      ],
      "PRIVATE_MP4_FFPROBE",
      { cancellationSignal: operation.cancellationSignal, input: mp4Bytes },
    );
    const probe = parseJson(output, "PRIVATE_MP4_FFPROBE");
    const duration = Number(probe?.format?.duration);
    if (
      !Number.isFinite(duration) ||
      duration < 30 ||
      duration > 60 ||
      !Array.isArray(probe?.streams) ||
      !probe.streams.some((stream) => stream?.codec_type === "video") ||
      !probe.streams.some((stream) => stream?.codec_type === "audio")
    )
      fail("V2_09_CONCRETE_PRIVATE_MP4_FFPROBE_INVALID");
    return {
      schema_version: "videoforge.v2-09-private-mp4-lineage/v1",
      operation_id: "verify-private-mp4-lineage",
      project_id_sha256: sha256(evidence.projectId),
      generation_request_sha256: sha256(evidence.generationRequestId),
      output_id_sha256: sha256(evidence.outputId),
      duration_seconds: duration,
      private_mp4: true,
      lineage_verified: true,
      ffprobe_verified: true,
      playback_verified: true,
      seek_verified: true,
      download_verified: true,
      mp4_sha256: evidence.outputSha256,
      lineage_evidence_sha256: sha256(
        canonical({
          browser_evidence: evidence,
          ffprobe: probe,
          verified_output_sha256: evidence.outputSha256,
        }),
      ),
    };
  };

  const deploymentIds = (authority) =>
    ["mage", "soulx"].map((lane) =>
      deterministicUuid(`${authority.authority_id}:deployment:${lane}`),
    );
  const readChromeRequest = () => chromeDocument;
  const loadStagedClickScope = () => {
    if (!existsSync(configuration.journalPath)) return null;
    const state = readJournal(configuration.journalPath);
    const scope = state.resources.stagedClickScope;
    if (scope === undefined) return null;
    if (
      !exactKeys(scope, [
        "accountId",
        "action",
        "generationRequestId",
        "projectId",
        "projectRevisionId",
        "schemaVersion",
        "workspaceId",
      ]) ||
      scope.schemaVersion !== "videoforge.v2-09-staged-click-scope/v1" ||
      ![
        "CLAIM_ONLY_NO_REQUEST",
        "REQUEST_NOT_MATERIALIZED",
        "UPSTREAM_RECONCILIATION_PENDING",
        "UPSTREAM_UNKNOWN_PRESERVED",
        "PROJECT_WITHOUT_GENERATION_PROJECT_ARCHIVED",
        "NO_PROVIDER_REQUEST_TERMINATED_PROJECT_ARCHIVED",
        "PROVIDER_PAIR_IDENTIFIED",
        "PROVIDER_FAILURE_TERMINAL_PROJECT_ARCHIVED",
        "PROVIDER_SUCCESS_PRESERVED",
        "CPU_CANCEL_PENDING",
      ].includes(scope.action) ||
      scope.accountId !== chromeDocument.request.accountId ||
      scope.workspaceId !== chromeDocument.request.workspaceId ||
      (scope.projectId !== null && !UUID.test(scope.projectId ?? "")) ||
      (scope.projectRevisionId !== null && !UUID.test(scope.projectRevisionId ?? "")) ||
      (scope.generationRequestId !== null && !UUID.test(scope.generationRequestId ?? ""))
    )
      fail("V2_09_CONCRETE_STAGED_CLICK_SCOPE_INVALID");
    return scope;
  };
  const readAttributableGenericProjectCost = async (authority, operation = {}) => {
    const scope = loadStagedClickScope();
    const captured = clickIdentity ?? loadClickIdentity(authority);
    const revisionId =
      scope?.projectRevisionId ??
      (["PROJECT_CREATED", "GENERATION_CREATED"].includes(captured?.stage)
        ? captured.identity.projectRevisionId
        : (chromeEvidence?.evidence?.projectRevisionId ?? null));
    if (UUID.test(revisionId ?? ""))
      return readGenericProjectRevisionNetCost(revisionId, operation);
    if (
      scope !== null &&
      scope.projectId === null &&
      scope.projectRevisionId === null &&
      scope.generationRequestId === null &&
      ["CLAIM_ONLY_NO_REQUEST", "REQUEST_NOT_MATERIALIZED"].includes(scope.action)
    )
      return 0;
    if (scope === null && captured === null && chromeEvidence === null) {
      const journal = readJournal(configuration.journalPath);
      if (
        journal.authority_id === authority.authority_id &&
        journal.normal["run-one-v209-chrome-e2e"] === undefined &&
        journal.resources.chromeClick === undefined &&
        journal.resources.stagedClickScope === undefined
      )
        return 0;
    }
    fail("V2_09_CONCRETE_GENERIC_COST_SCOPE_UNPROVEN");
  };
  const reconcileStagedClick = async (authority, operation = {}) => {
    const captured = clickIdentity ?? loadClickIdentity(authority);
    if (captured === null) return null;
    const identity = captured.identity;
    const payload = {
      accountId: chromeDocument.request.accountId,
      claimId: captured.claimId,
      createRequestSha256: captured.lookup?.createRequestSha256 ?? null,
      generationRequestId:
        captured.stage === "GENERATION_CREATED" ? identity.generationRequestId : null,
      idempotencyKey: captured.lookup?.idempotencyKey ?? null,
      issuedAt: authority.issued_at,
      projectId: ["PROJECT_CREATED", "GENERATION_CREATED"].includes(captured.stage)
        ? identity.projectId
        : null,
      projectRevisionId: ["PROJECT_CREATED", "GENERATION_CREATED"].includes(captured.stage)
        ? identity.projectRevisionId
        : null,
      schemaVersion: "videoforge.v2-09-staged-click-reconciliation/v1",
      stage: captured.stage,
      workspaceId: chromeDocument.request.workspaceId,
    };
    const output = await exactChild(
      runChild,
      configuration,
      "psql",
      [
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--quiet",
        "--tuples-only",
        "--no-align",
        "--variable",
        `payload_base64=${Buffer.from(canonical(payload), "utf8").toString("base64")}`,
        "--file",
        resolve(ROOT, "deploy/v2-09/neon-reconcile-v209-staged-click.sql"),
      ],
      "RECONCILE_STAGED_CLICK",
      {
        cancellationSignal: operation.cancellationSignal,
        env: postgresEnvironmentFor("databaseReconcilerUrlFile"),
      },
    );
    const value = parseJson(output, "RECONCILE_STAGED_CLICK");
    const action = value?.action;
    const materialized = value?.requestMaterialized === true;
    const receiptDocument = Object.fromEntries(
      Object.entries(value ?? {}).filter(([key]) => key !== "receiptSha256"),
    );
    if (
      !exactKeys(value, [
        "action",
        "activeCpuWorkCount",
        "activeLeaseCount",
        "activeUpstreamWork",
        "cpuCancelPending",
        "cpuEventCount",
        "generationAttemptCount",
        "generationRequestId",
        "generationRequestState",
        "pairPhase",
        "projectArchived",
        "projectId",
        "projectRevisionId",
        "projectState",
        "providerActiveAttemptCount",
        "providerAssignmentCount",
        "providerMayHaveCharged",
        "providerPairIdentified",
        "providerSentOrUnknownCount",
        "queueAuditCount",
        "receiptSha256",
        "reconciledAt",
        "releaseReason",
        "releasedLeaseCount",
        "replayed",
        "requestMaterialized",
        "runtimeEventCount",
        "runtimeStage",
        "safeToArchive",
        "schemaVersion",
        "stage",
        "terminalGenerationAttemptCount",
        "upstreamDispatchingCount",
        "upstreamReconciliationPending",
        "upstreamUnknownCount",
      ]) ||
      value.schemaVersion !== "videoforge.v2-09-staged-click-reconciliation-result/v2" ||
      value.stage !== captured.stage ||
      ![
        "CLAIM_ONLY_NO_REQUEST",
        "REQUEST_NOT_MATERIALIZED",
        "UPSTREAM_RECONCILIATION_PENDING",
        "UPSTREAM_UNKNOWN_PRESERVED",
        "PROJECT_WITHOUT_GENERATION_PROJECT_ARCHIVED",
        "NO_PROVIDER_REQUEST_TERMINATED_PROJECT_ARCHIVED",
        "PROVIDER_PAIR_IDENTIFIED",
        "PROVIDER_FAILURE_TERMINAL_PROJECT_ARCHIVED",
        "PROVIDER_SUCCESS_PRESERVED",
        "CPU_CANCEL_PENDING",
      ].includes(action) ||
      typeof value.replayed !== "boolean" ||
      value.receiptSha256 !== sha256(canonical(receiptDocument)) ||
      !Number.isFinite(Date.parse(value.reconciledAt)) ||
      ![0, 2].includes(value.generationAttemptCount) ||
      !Number.isSafeInteger(value.terminalGenerationAttemptCount) ||
      value.terminalGenerationAttemptCount < 0 ||
      value.terminalGenerationAttemptCount > value.generationAttemptCount ||
      !Number.isSafeInteger(value.providerAssignmentCount) ||
      value.providerAssignmentCount < 0 ||
      value.providerAssignmentCount > value.generationAttemptCount ||
      !Number.isSafeInteger(value.providerSentOrUnknownCount) ||
      value.providerSentOrUnknownCount < 0 ||
      value.providerSentOrUnknownCount > value.generationAttemptCount ||
      !Number.isSafeInteger(value.providerActiveAttemptCount) ||
      value.providerActiveAttemptCount < 0 ||
      value.providerActiveAttemptCount > value.generationAttemptCount ||
      !Number.isSafeInteger(value.activeCpuWorkCount) ||
      value.activeCpuWorkCount < 0 ||
      !Number.isSafeInteger(value.activeLeaseCount) ||
      value.activeLeaseCount < 0 ||
      !Number.isSafeInteger(value.releasedLeaseCount) ||
      value.releasedLeaseCount < 0 ||
      !Number.isSafeInteger(value.queueAuditCount) ||
      value.queueAuditCount < 0 ||
      !Number.isSafeInteger(value.runtimeEventCount) ||
      value.runtimeEventCount < 0 ||
      !Number.isSafeInteger(value.cpuEventCount) ||
      value.cpuEventCount < 0 ||
      !Number.isSafeInteger(value.upstreamDispatchingCount) ||
      value.upstreamDispatchingCount < 0 ||
      !Number.isSafeInteger(value.upstreamUnknownCount) ||
      value.upstreamUnknownCount < 0 ||
      !Array.isArray(value.activeUpstreamWork) ||
      value.activeUpstreamWork.length !==
        value.upstreamDispatchingCount + value.upstreamUnknownCount ||
      value.activeUpstreamWork.some(
        (entry) =>
          !exactKeys(entry, ["id", "kind", "providerMayHaveCharged", "state"]) ||
          !UUID.test(entry.id ?? "") ||
          !["VOICEOVER_CONTEXT", "PROMPT_RUN"].includes(entry.kind) ||
          !["DISPATCHING", "UNKNOWN"].includes(entry.state) ||
          entry.providerMayHaveCharged !== true,
      ) ||
      typeof value.providerMayHaveCharged !== "boolean" ||
      typeof value.providerPairIdentified !== "boolean" ||
      typeof value.cpuCancelPending !== "boolean" ||
      typeof value.upstreamReconciliationPending !== "boolean" ||
      value.upstreamReconciliationPending !== value.upstreamDispatchingCount > 0 ||
      typeof value.safeToArchive !== "boolean" ||
      (value.releaseReason !== null && typeof value.releaseReason !== "string") ||
      (materialized &&
        (!UUID.test(value.projectId ?? "") || !UUID.test(value.projectRevisionId ?? ""))) ||
      (!materialized &&
        (value.projectId !== null ||
          value.projectRevisionId !== null ||
          value.generationRequestId !== null)) ||
      (value.generationRequestId !== null && !UUID.test(value.generationRequestId ?? "")) ||
      (value.pairPhase !== null && typeof value.pairPhase !== "string") ||
      (value.activeCpuWorkCount > 0 && action !== "CPU_CANCEL_PENDING") ||
      value.cpuCancelPending !== value.activeCpuWorkCount > 0 ||
      value.providerPairIdentified !== (value.generationAttemptCount === 2) ||
      (value.generationAttemptCount === 2 &&
        ![
          "PROVIDER_PAIR_IDENTIFIED",
          "PROVIDER_FAILURE_TERMINAL_PROJECT_ARCHIVED",
          "PROVIDER_SUCCESS_PRESERVED",
        ].includes(action)) ||
      (value.generationAttemptCount === 2 && typeof value.pairPhase !== "string") ||
      (action === "PROVIDER_SUCCESS_PRESERVED" &&
        (value.pairPhase !== "SETTLED" ||
          value.releaseReason !== "HOSTED_PAIR_OUTPUTS_ACCEPTED")) ||
      (action === "PROVIDER_FAILURE_TERMINAL_PROJECT_ARCHIVED" &&
        (value.pairPhase !== "SETTLED" || value.activeLeaseCount !== 0)) ||
      (value.generationAttemptCount === 0 &&
        value.activeCpuWorkCount === 0 &&
        materialized &&
        value.projectArchived !== true &&
        !["UPSTREAM_RECONCILIATION_PENDING", "UPSTREAM_UNKNOWN_PRESERVED"].includes(action)) ||
      (value.projectArchived === true && value.projectState !== "ARCHIVED") ||
      (value.generationAttemptCount === 0 &&
        value.activeCpuWorkCount === 0 &&
        value.activeLeaseCount !== 0)
    )
      fail("V2_09_CONCRETE_STAGED_CLICK_RECONCILIATION_INVALID");
    return recordStagedClickScope(authority, value);
  };
  const cleanupScopePayload = (authority, schemaVersion) => {
    const document = readChromeRequest();
    const captured = clickIdentity ?? loadClickIdentity(authority);
    const stagedScope = loadStagedClickScope();
    return {
      schemaVersion,
      accountId: document.request?.accountId,
      workspaceId: document.request?.workspaceId,
      generationRequestId:
        stagedScope?.generationRequestId ??
        (captured?.stage === "GENERATION_CREATED"
          ? captured.identity.generationRequestId
          : (chromeEvidence?.evidence?.generationRequestId ?? null)),
      issuedAt: authority.issued_at,
      deploymentIds: deploymentIds(authority),
    };
  };
  const readCleanupState = async (authority, operation = {}) => {
    const payload = cleanupScopePayload(authority, "videoforge.v2-09-cleanup-state-request/v1");
    const output = await exactChild(
      runChild,
      configuration,
      "psql",
      [
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--quiet",
        "--tuples-only",
        "--no-align",
        "--variable",
        `payload_base64=${Buffer.from(canonical(payload), "utf8").toString("base64")}`,
        "--file",
        resolve(ROOT, "deploy/v2-09/neon-read-v209-cleanup-state.sql"),
      ],
      "READ_CLEANUP_STATE",
      {
        cancellationSignal: operation.cancellationSignal,
        env: postgresEnvironmentFor("databaseOwnerUrlFile"),
      },
    );
    const value = parseJson(output, "READ_CLEANUP_STATE");
    if (
      value?.schemaVersion !== "videoforge.v2-09-cleanup-state-result/v1" ||
      (value.generationRequestId !== null && !UUID.test(value.generationRequestId ?? "")) ||
      !Array.isArray(value.deployments) ||
      value.deployments.length > 2 ||
      !Array.isArray(value.jobs) ||
      value.jobs.length > 2 ||
      value.jobs.some((job) => {
        const assigned = typeof job?.jobId === "string";
        const sealedRate =
          job?.rateSource === "V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR" &&
          Number.isFinite(Date.parse(job?.rateCheckedAt));
        const noRate = job?.rateSource === null && job?.rateCheckedAt === null;
        const durableTerminal = assigned && value.pairPhase === "SETTLED";
        const successCostPending =
          durableTerminal &&
          ["RENDERING", "COMPLETE"].includes(value.runtimeStage) &&
          job.terminalCostBasis === null &&
          job.terminalExecutionTimeMs === null &&
          job.terminalCostUsd === null &&
          job.terminalRateCheckedAt === null &&
          job.terminalCostConfidence === null &&
          Number(job.costUsd) === 0;
        const terminalBasisValid = ["exact_execution", "conservative_reservation"].includes(
          job?.terminalCostBasis,
        );
        return (
          !["mage", "soulx"].includes(job?.lane) ||
          !Number.isFinite(Number(job.ceilingUsd)) ||
          Number(job.ceilingUsd) <= 0 ||
          !Number.isFinite(Number(job.costUsd)) ||
          Number(job.costUsd) < 0 ||
          (assigned && !HASH.test(job.jobIdSha256 ?? "")) ||
          (!assigned && (job?.jobId !== null || job?.jobIdSha256 !== null)) ||
          (assigned && !sealedRate) ||
          (!assigned && !noRate && !sealedRate) ||
          (durableTerminal && !HASH.test(job.terminalProofSha256 ?? "")) ||
          (durableTerminal && !Number.isFinite(Date.parse(job.terminalObservedAt))) ||
          (durableTerminal && !successCostPending && !terminalBasisValid) ||
          (durableTerminal &&
            !successCostPending &&
            Number(job.terminalCostUsd) !== Number(job.costUsd)) ||
          (durableTerminal &&
            !successCostPending &&
            Date.parse(job.terminalRateCheckedAt) !== Date.parse(job.rateCheckedAt)) ||
          (durableTerminal &&
            !successCostPending &&
            job.terminalCostConfidence !==
              (job.terminalCostBasis === "exact_execution" ? "PROVIDER_REPORTED" : "ESTIMATED")) ||
          (durableTerminal &&
            !successCostPending &&
            job.terminalCostBasis === "exact_execution" &&
            (!Number.isSafeInteger(job.terminalExecutionTimeMs) ||
              job.terminalExecutionTimeMs < 0)) ||
          (durableTerminal &&
            !successCostPending &&
            job.terminalCostBasis === "conservative_reservation" &&
            job.terminalExecutionTimeMs !== null)
        );
      }) ||
      !Number.isFinite(Number(value.totalSettledCostUsd)) ||
      Number(value.totalSettledCostUsd) < 0 ||
      !Number.isFinite(Number(value.exactItemizedCostUsd)) ||
      Number(value.exactItemizedCostUsd) < 0 ||
      !Number.isFinite(Number(value.conservativeLiabilityUsd)) ||
      Number(value.conservativeLiabilityUsd) < 0 ||
      usdMicros(value.exactItemizedCostUsd) + usdMicros(value.conservativeLiabilityUsd) !==
        usdMicros(value.totalSettledCostUsd) ||
      ![
        "activeLeaseCount",
        "assignmentCount",
        "exactPairTerminalCount",
        "failedLaneCount",
        "nonzeroCostSettlementCount",
        "providerTerminalEvidenceCount",
        "releasedLeaseCount",
        "sentOrUnknownOutboxCount",
        "settledEventCount",
        "terminalOutboxCount",
        "terminalTaskCount",
        "zeroCostSettlementCount",
      ].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)
    )
      fail("V2_09_CONCRETE_CLEANUP_STATE_INVALID");
    cleanupState = value;
    return value;
  };
  const reconcileUnassignedAttempts = async (authority, operation = {}, state = null) => {
    const payload = {
      ...cleanupScopePayload(authority, "videoforge.v2-09-reconcile-unassigned-attempts/v1"),
      generationRequestId:
        state?.generationRequestId ?? chromeEvidence?.evidence?.generationRequestId ?? null,
    };
    const output = await exactChild(
      runChild,
      configuration,
      "psql",
      [
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--quiet",
        "--tuples-only",
        "--no-align",
        "--variable",
        `payload_base64=${Buffer.from(canonical(payload), "utf8").toString("base64")}`,
        "--file",
        resolve(ROOT, "deploy/v2-09/neon-reconcile-v209-unassigned-attempts.sql"),
      ],
      "RECONCILE_UNASSIGNED_ATTEMPTS",
      {
        cancellationSignal: operation.cancellationSignal,
        env: postgresEnvironmentFor("databaseOwnerUrlFile"),
      },
    );
    const value = parseJson(output, "RECONCILE_UNASSIGNED_ATTEMPTS");
    const expectedKeys = [
      "activeLeaseCount",
      "cancelledAttemptCount",
      "deadLetterOutboxCount",
      "failedLaneCount",
      "failedTaskCount",
      "generationRequestState",
      "nonzeroCostSettlementCount",
      "pairPhase",
      "providerAssignmentCount",
      "reconciledAt",
      "reconciledPairCount",
      "releasedLeaseCount",
      "runtimeStage",
      "schemaVersion",
      "sentOrUnknownOutboxCount",
      "zeroCostSettlementCount",
    ];
    if (
      !exactKeys(value, expectedKeys) ||
      value.schemaVersion !== "videoforge.v2-09-unassigned-reconciliation-result/v2" ||
      ![0, 1].includes(value.reconciledPairCount) ||
      value.activeLeaseCount !== 0 ||
      value.providerAssignmentCount !== 0 ||
      value.sentOrUnknownOutboxCount !== 0 ||
      (value.reconciledPairCount === 0 &&
        (value.cancelledAttemptCount !== 0 ||
          value.deadLetterOutboxCount !== 0 ||
          value.failedLaneCount !== 0 ||
          value.failedTaskCount !== 0 ||
          value.releasedLeaseCount !== 0 ||
          value.zeroCostSettlementCount !== 0 ||
          value.nonzeroCostSettlementCount !== 0 ||
          value.generationRequestState !== null ||
          value.runtimeStage !== null ||
          value.pairPhase !== null)) ||
      (value.reconciledPairCount === 1 &&
        (value.cancelledAttemptCount !== 2 ||
          !Number.isSafeInteger(value.deadLetterOutboxCount) ||
          value.deadLetterOutboxCount < 0 ||
          value.deadLetterOutboxCount > 2 ||
          value.failedLaneCount !== 2 ||
          value.failedTaskCount !== 2 ||
          value.releasedLeaseCount !== 1 ||
          value.zeroCostSettlementCount !== 2 ||
          value.nonzeroCostSettlementCount !== 0 ||
          value.generationRequestState !== "FAILED" ||
          value.runtimeStage !== "FAILED" ||
          value.pairPhase !== "SETTLED")) ||
      !Number.isFinite(Date.parse(value.reconciledAt))
    )
      fail("V2_09_CONCRETE_UNASSIGNED_RECONCILIATION_INVALID");
    return value;
  };
  const protectedDeploymentValues = (authority, state) => {
    const byLane = new Map();
    if (existsSync(configuration.journalPath)) {
      const journal = readJournal(configuration.journalPath);
      for (const lane of ["mage", "soulx"]) {
        if (journal.resources[lane]) byLane.set(lane, journal.resources[lane]);
      }
    }
    for (const [lane, deployment] of providerDeployments) byLane.set(lane, deployment);
    for (const row of state.deployments) {
      const binding = authority.scope.lanes.find(({ lane }) => lane === row.lane);
      if (
        !binding ||
        row.endpointIdSha256 !== sha256(String(row.endpointId)) ||
        row.templateIdSha256 !== sha256(String(row.templateId)) ||
        row.imageSha256 !== binding.image_sha256 ||
        row.volumeIdSha256 !== binding.volume_id_sha256 ||
        row.volumeManifestSha256 !== binding.volume_manifest_sha256
      )
        fail("V2_09_CONCRETE_CLEANUP_DEPLOYMENT_DRIFT");
      byLane.set(row.lane, {
        lane: row.lane,
        purpose: "production",
        resourceKey: `${authority.authority_id}-${row.lane}-production`,
        endpointId: row.endpointId,
        templateId: row.templateId,
        endpointIdSha256: row.endpointIdSha256,
        templateIdSha256: row.templateIdSha256,
        deploymentSha256: row.deploymentSha256,
        image:
          row.lane === "mage"
            ? `ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@${binding.image_sha256}`
            : `ghcr.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@${binding.image_sha256}`,
        sourceCommit: authority.source_commit,
        volumeIdSha256: binding.volume_id_sha256,
        volumeManifestSha256: binding.volume_manifest_sha256,
        volumeSizeGb: 50,
        volumeMount: "/runpod-volume",
        region: "EU-RO-1",
        gpu: "NVIDIA GeForce RTX 4090",
        gpuCount: 1,
        workersMin: 0,
        workersMax: 1,
        idleTimeoutSeconds: 5,
        handlerConcurrency: 1,
        scalerType: "REQUEST_COUNT",
        scalerValue: 1,
        initTimeoutSeconds: 800,
      });
    }
    return ["mage", "soulx"].flatMap((lane) => (byLane.has(lane) ? [byLane.get(lane)] : []));
  };
  const invokeRunPodReconciliation = async (
    authority,
    operation,
    command,
    state,
    { includeJobs = true } = {},
  ) => {
    const apiKey = protectedText("runpodApiKeyFile");
    const workerEnvironment = parseJson(
      protectedText("runpodWorkerEnvironmentFile"),
      "RUNPOD_WORKER_ENVIRONMENT",
    );
    const output = await exactChild(
      runChild,
      configuration,
      "pnpm",
      [
        "--filter",
        "@videoforge/web",
        "exec",
        "tsx",
        resolve(ROOT, "deploy/v2-09/v209-runpod-production-bridge.ts"),
      ],
      "RUNPOD_RECONCILIATION",
      {
        cancellationSignal: operation.cancellationSignal,
        input: `${canonical({
          schema_version: "videoforge.v2-09-runpod-production-bridge/v1",
          command,
          authority_id: authority.authority_id,
          source_commit: authority.source_commit,
          api_key: apiKey,
          lanes: authority.scope.lanes.map((lane) => ({
            lane: lane.lane,
            image_sha256: lane.image_sha256,
            image_source_commit: lane.image_source_commit,
            image_config_sha256: lane.image_config_sha256,
            anonymous_proof_sha256: lane.anonymous_proof_sha256,
            acceptance_sha256: lane.acceptance_sha256,
            volume_id_sha256: lane.volume_id_sha256,
            volume_manifest_sha256: lane.volume_manifest_sha256,
          })),
          worker_environment: workerEnvironment,
          deployments: protectedDeploymentValues(authority, state),
          jobs: includeJobs
            ? state.jobs.flatMap((job) =>
                typeof job.jobId === "string"
                  ? [{ lane: job.lane, job_id: job.jobId, status: job.status ?? null }]
                  : [],
              )
            : [],
        })}\n`,
      },
    );
    const value = parseJson(output, "RUNPOD_RECONCILIATION");
    if (
      value?.schema_version !== "videoforge.v2-09-runpod-production-bridge-result/v1" ||
      value.command !== command ||
      !Array.isArray(value.terminal_jobs) ||
      value.terminal_jobs.some(
        (job) =>
          !["mage", "soulx"].includes(job?.lane) ||
          !HASH.test(job?.job_id_sha256 ?? "") ||
          !["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(job?.status) ||
          (job.execution_time_ms !== null &&
            (!Number.isSafeInteger(job.execution_time_ms) || job.execution_time_ms < 0)),
      ) ||
      !Array.isArray(value.inventory?.endpointIdSha256s) ||
      !Array.isArray(value.inventory?.volumes) ||
      !Number.isSafeInteger(value.inventory?.activeWorkers) ||
      !Number.isSafeInteger(value.inventory?.runningPods) ||
      !Number.isSafeInteger(value.inventory?.queuedJobs)
    )
      fail("V2_09_CONCRETE_RUNPOD_RECONCILIATION_INVALID");
    return value;
  };

  const validateTerminalSettlementReceipt = (value, assignedCount) => {
    const expectedKeys = [
      "activeLeaseCount",
      "assignmentCount",
      "conservativeLiabilityUsd",
      "exactPairTerminalCount",
      "exactItemizedCostUsd",
      "failedLaneCount",
      "generationRequestState",
      "nonzeroCostSettlementCount",
      "pairPhase",
      "providerTerminalEvidenceCount",
      "reconciledAt",
      "releasedLeaseCount",
      "runtimeStage",
      "schemaVersion",
      "settledEventCount",
      "terminalOutboxCount",
      "terminalTaskCount",
      "totalSettledCostUsd",
      "zeroCostSettlementCount",
      "zeroWorkerProofCount",
    ];
    if (
      !exactKeys(value, expectedKeys) ||
      value.schemaVersion !== "videoforge.v2-09-terminal-pair-settlement-result/v1" ||
      value.exactPairTerminalCount !== 2 ||
      value.activeLeaseCount !== 0 ||
      value.releasedLeaseCount !== 1 ||
      value.assignmentCount !== assignedCount ||
      value.providerTerminalEvidenceCount !== assignedCount ||
      value.settledEventCount !== 2 ||
      !Number.isSafeInteger(value.terminalOutboxCount) ||
      value.terminalOutboxCount < 0 ||
      value.terminalOutboxCount > 2 ||
      value.terminalTaskCount !== 2 ||
      value.zeroWorkerProofCount !== 2 ||
      value.zeroCostSettlementCount + value.nonzeroCostSettlementCount !== 2 ||
      !Number.isFinite(Number(value.totalSettledCostUsd)) ||
      Number(value.totalSettledCostUsd) < 0 ||
      !Number.isFinite(Number(value.exactItemizedCostUsd)) ||
      Number(value.exactItemizedCostUsd) < 0 ||
      !Number.isFinite(Number(value.conservativeLiabilityUsd)) ||
      Number(value.conservativeLiabilityUsd) < 0 ||
      usdMicros(value.exactItemizedCostUsd) + usdMicros(value.conservativeLiabilityUsd) !==
        usdMicros(value.totalSettledCostUsd) ||
      value.generationRequestState !== "FAILED" ||
      value.runtimeStage !== "FAILED" ||
      value.failedLaneCount !== 2 ||
      value.pairPhase !== "SETTLED" ||
      !Number.isFinite(Date.parse(value.reconciledAt))
    )
      fail("V2_09_CONCRETE_TERMINAL_SETTLEMENT_INVALID");
    return value;
  };

  const settleTerminalPair = async (authority, operation, state, terminalProof) => {
    if (
      !UUID.test(state.generationRequestId ?? "") ||
      state.deployments.length !== 2 ||
      terminalProof.inventory.activeWorkers !== 0 ||
      terminalProof.inventory.runningPods !== 0 ||
      terminalProof.inventory.queuedJobs !== 0
    )
      fail("V2_09_CONCRETE_TERMINAL_SETTLEMENT_SCOPE_INVALID");
    const byLane = new Map(terminalProof.terminal_jobs.map((job) => [job.lane, job]));
    const maxRate = Number(authority.offering.max_rate_usd_per_gpu_hour);
    if (!Number.isFinite(maxRate) || maxRate !== 1.116)
      fail("V2_09_CONCRETE_TERMINAL_SETTLEMENT_RATE_INVALID");
    const observedAt = terminalProof.inventory.checkedAt;
    if (!Number.isFinite(Date.parse(observedAt)))
      fail("V2_09_CONCRETE_TERMINAL_SETTLEMENT_TIME_INVALID");
    const terminalFacts = state.jobs.flatMap((job) => {
      if (typeof job.jobId !== "string") return [];
      const provider = byLane.get(job.lane);
      if (!provider || provider.job_id_sha256 !== job.jobIdSha256)
        fail("V2_09_CONCRETE_TERMINAL_SETTLEMENT_JOB_DRIFT");
      const ceiling = Number(job.ceilingUsd);
      if (!Number.isFinite(ceiling) || ceiling <= 0)
        fail("V2_09_CONCRETE_TERMINAL_SETTLEMENT_COST_INVALID");
      const exactExecution =
        Number.isSafeInteger(provider.execution_time_ms) && provider.execution_time_ms >= 0;
      const settledCostUsd = exactExecution
        ? exactExecutionCostUsd(provider.execution_time_ms, maxRate)
        : ceiling;
      if (!Number.isFinite(settledCostUsd) || settledCostUsd > ceiling)
        fail("V2_09_CONCRETE_TERMINAL_SETTLEMENT_COST_INVALID");
      const unsigned = {
        costBasis: exactExecution ? "exact_execution" : "conservative_reservation",
        executionTimeMs: exactExecution ? provider.execution_time_ms : null,
        lane: job.lane === "mage" ? "mage_image" : "soulx_avatar",
        observedAt,
        providerJobId: job.jobId,
        providerState: provider.status,
        rateCheckedAt: job.rateCheckedAt,
        rateSource: job.rateSource,
        settledCostUsd,
      };
      return [{ ...unsigned, proofSha256: sha256(canonical(unsigned)) }];
    });
    if (terminalFacts.length < 1 || terminalFacts.length > 2)
      fail("V2_09_CONCRETE_TERMINAL_SETTLEMENT_FACTS_INVALID");
    const zeroWorkerFacts = state.deployments.map((deployment) => {
      const unsigned = {
        endpointIdSha256: deployment.endpointIdSha256,
        lane: deployment.lane === "mage" ? "mage_image" : "soulx_avatar",
        observedAt,
        queuedJobs: terminalProof.inventory.queuedJobs,
        workersTotal: terminalProof.inventory.activeWorkers,
      };
      return { ...unsigned, proofSha256: sha256(canonical(unsigned)) };
    });
    const billingTotal = await readCumulativeRunPodBilling();
    const providerObserved = now();
    if (!(providerObserved instanceof Date) || !Number.isFinite(providerObserved.getTime()))
      fail("V2_09_CONCRETE_CLOCK_INVALID");
    const payload = {
      accountId: chromeDocument.request.accountId,
      costGuard: {
        finalCumulativeEndpointBillingMicroUsd: Math.round(billingTotal * 1_000_000),
        providerObservedAt: providerObserved.toISOString(),
        schemaVersion: "videoforge-v2-09-settlement-cost-guard/v1",
      },
      generationRequestId: state.generationRequestId,
      schemaVersion: "videoforge.v2-09-terminal-pair-settlement/v1",
      terminalFacts,
      workspaceId: chromeDocument.request.workspaceId,
      zeroWorkerFacts,
    };
    const output = await exactChild(
      runChild,
      configuration,
      "psql",
      [
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--quiet",
        "--tuples-only",
        "--no-align",
        "--variable",
        `payload_base64=${Buffer.from(canonical(payload), "utf8").toString("base64")}`,
        "--file",
        resolve(ROOT, "deploy/v2-09/neon-settle-v209-terminal-pair.sql"),
      ],
      "SETTLE_TERMINAL_PAIR",
      {
        cancellationSignal: operation.cancellationSignal,
        env: postgresEnvironmentFor("databaseOwnerUrlFile"),
      },
    );
    return validateTerminalSettlementReceipt(
      parseJson(output, "SETTLE_TERMINAL_PAIR"),
      terminalFacts.length,
    );
  };

  const settleSuccessCosts = async (authority, operation, state, terminalProof) => {
    if (
      !UUID.test(state.generationRequestId ?? "") ||
      state.jobs.length !== 2 ||
      terminalProof.inventory.activeWorkers !== 0 ||
      terminalProof.inventory.runningPods !== 0 ||
      terminalProof.inventory.queuedJobs !== 0 ||
      !Number.isFinite(Date.parse(terminalProof.inventory.checkedAt))
    )
      fail("V2_09_CONCRETE_SUCCESS_COST_SCOPE_INVALID");
    const providerByLane = new Map(terminalProof.terminal_jobs.map((job) => [job.lane, job]));
    const terminalFacts = state.jobs.map((job) => {
      const provider = providerByLane.get(job.lane);
      if (
        typeof job.jobId !== "string" ||
        !HASH.test(job.jobIdSha256 ?? "") ||
        job.jobIdSha256 !== sha256(job.jobId) ||
        job.rateSource !== "V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR" ||
        !Number.isFinite(Date.parse(job.rateCheckedAt)) ||
        provider?.job_id_sha256 !== job.jobIdSha256 ||
        provider.status !== "COMPLETED" ||
        !Number.isSafeInteger(provider.execution_time_ms) ||
        provider.execution_time_ms < 0
      )
        fail("V2_09_CONCRETE_SUCCESS_COST_FACT_INVALID");
      const unsigned = {
        executionTimeMs: provider.execution_time_ms,
        lane: job.lane === "mage" ? "mage_image" : "soulx_avatar",
        observedAt: terminalProof.inventory.checkedAt,
        providerJobId: job.jobId,
        providerJobIdSha256: job.jobIdSha256,
        providerState: provider.status,
        rateCheckedAt: job.rateCheckedAt,
        rateSource: job.rateSource,
      };
      return { ...unsigned, proofSha256: sha256(canonical(unsigned)) };
    });
    const payload = {
      accountId: chromeDocument.request.accountId,
      generationRequestId: state.generationRequestId,
      schemaVersion: "videoforge.v2-09-success-cost-settlement/v1",
      terminalFacts,
      workspaceId: chromeDocument.request.workspaceId,
    };
    const output = await exactChild(
      runChild,
      configuration,
      "psql",
      [
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--quiet",
        "--tuples-only",
        "--no-align",
        "--variable",
        `payload_base64=${Buffer.from(canonical(payload), "utf8").toString("base64")}`,
        "--file",
        resolve(ROOT, "deploy/v2-09/neon-settle-v209-success-costs.sql"),
      ],
      "SETTLE_SUCCESS_COSTS",
      {
        cancellationSignal: operation.cancellationSignal,
        env: postgresEnvironmentFor("databaseReconcilerUrlFile"),
      },
    );
    const receipt = parseJson(output, "SETTLE_SUCCESS_COSTS");
    const expectedKeys = [
      "conservativeGpuLiabilityMicroUsd",
      "exactGpuCostMicroUsd",
      "generationRequestId",
      "genericProjectRevisionNetCostIncluded",
      "lanes",
      "projectRevisionId",
      "replayed",
      "schemaVersion",
      "settledAt",
    ];
    if (
      !exactKeys(receipt, expectedKeys) ||
      receipt.schemaVersion !== "videoforge.hosted-v209-success-cost-settlement/v1" ||
      receipt.generationRequestId !== state.generationRequestId ||
      !UUID.test(receipt.projectRevisionId ?? "") ||
      receipt.genericProjectRevisionNetCostIncluded !== false ||
      receipt.conservativeGpuLiabilityMicroUsd !== 0 ||
      !Number.isSafeInteger(receipt.exactGpuCostMicroUsd) ||
      receipt.exactGpuCostMicroUsd < 0 ||
      receipt.exactGpuCostMicroUsd > 2_000_000 ||
      typeof receipt.replayed !== "boolean" ||
      !Number.isFinite(Date.parse(receipt.settledAt)) ||
      !Array.isArray(receipt.lanes) ||
      receipt.lanes.length !== 2
    )
      fail("V2_09_CONCRETE_SUCCESS_COST_RECEIPT_INVALID");
    const receiptByLane = new Map(receipt.lanes.map((lane) => [lane.lane, lane]));
    let expectedTotal = 0;
    for (const fact of terminalFacts) {
      const lane = receiptByLane.get(fact.lane);
      const expectedCostUsd = exactExecutionCostUsd(fact.executionTimeMs, 1.116);
      const expectedCostMicroUsd = usdMicros(expectedCostUsd);
      if (
        !exactKeys(lane, [
          "attemptId",
          "costMicroUsd",
          "executionTimeMs",
          "lane",
          "providerJobIdSha256",
          "providerProofSha256",
          "providerReportEventId",
          "rateCheckedAt",
          "rateSource",
          "settledEventId",
        ]) ||
        !UUID.test(lane.attemptId ?? "") ||
        !UUID.test(lane.providerReportEventId ?? "") ||
        !UUID.test(lane.settledEventId ?? "") ||
        lane.executionTimeMs !== fact.executionTimeMs ||
        lane.providerJobIdSha256 !== fact.providerJobIdSha256 ||
        lane.providerProofSha256 !== fact.proofSha256 ||
        lane.rateSource !== fact.rateSource ||
        Date.parse(lane.rateCheckedAt) !== Date.parse(fact.rateCheckedAt) ||
        lane.costMicroUsd !== expectedCostMicroUsd
      )
        fail("V2_09_CONCRETE_SUCCESS_COST_RECEIPT_INVALID");
      expectedTotal += expectedCostMicroUsd;
    }
    if (receipt.exactGpuCostMicroUsd !== expectedTotal)
      fail("V2_09_CONCRETE_SUCCESS_COST_RECEIPT_INVALID");
    return receipt;
  };

  const assertFailureTerminalPostread = (state, settlement) => {
    if (settlement.reconciledPairCount === 0) {
      if (
        state.generationRequestId !== null ||
        state.jobs.length !== 0 ||
        state.activeLeaseCount !== 0 ||
        state.settledEventCount !== 0
      )
        fail("V2_09_CONCRETE_FAILURE_POSTREAD_INVALID");
      return;
    }
    if (
      !UUID.test(state.generationRequestId ?? "") ||
      state.generationRequestState !== "FAILED" ||
      state.runtimeStage !== "FAILED" ||
      state.pairPhase !== "SETTLED" ||
      state.activeLeaseCount !== 0 ||
      state.releasedLeaseCount !== 1 ||
      state.exactPairTerminalCount !== 2 ||
      state.failedLaneCount !== 2 ||
      state.sentOrUnknownOutboxCount !== 0 ||
      state.settledEventCount !== 2 ||
      state.terminalOutboxCount !==
        (settlement.terminalOutboxCount ?? settlement.deadLetterOutboxCount ?? 0) ||
      state.terminalTaskCount !== 2 ||
      state.zeroCostSettlementCount + state.nonzeroCostSettlementCount !== 2 ||
      state.assignmentCount !==
        (settlement.assignmentCount ?? settlement.providerAssignmentCount ?? 0) ||
      state.providerTerminalEvidenceCount !== state.assignmentCount ||
      state.zeroCostSettlementCount !== settlement.zeroCostSettlementCount ||
      state.nonzeroCostSettlementCount !== settlement.nonzeroCostSettlementCount ||
      usdMicros(state.totalSettledCostUsd) !== usdMicros(settlement.totalSettledCostUsd ?? 0) ||
      usdMicros(state.exactItemizedCostUsd) !== usdMicros(settlement.exactItemizedCostUsd ?? 0) ||
      usdMicros(state.conservativeLiabilityUsd) !==
        usdMicros(settlement.conservativeLiabilityUsd ?? 0)
    )
      fail("V2_09_CONCRETE_FAILURE_POSTREAD_INVALID");
  };

  const isExactlySettledFailurePair = (state) =>
    UUID.test(state.generationRequestId ?? "") &&
    state.generationRequestState === "FAILED" &&
    state.runtimeStage === "FAILED" &&
    state.pairPhase === "SETTLED" &&
    state.activeLeaseCount === 0 &&
    state.releasedLeaseCount === 1 &&
    state.exactPairTerminalCount === 2 &&
    state.failedLaneCount === 2 &&
    state.sentOrUnknownOutboxCount === 0 &&
    state.settledEventCount === 2 &&
    state.providerTerminalEvidenceCount === state.assignmentCount &&
    usdMicros(state.exactItemizedCostUsd) + usdMicros(state.conservativeLiabilityUsd) ===
      usdMicros(state.totalSettledCostUsd) &&
    Number.isSafeInteger(state.terminalOutboxCount) &&
    state.terminalOutboxCount >= 0 &&
    state.terminalOutboxCount <= 2 &&
    state.terminalTaskCount === 2 &&
    state.zeroCostSettlementCount + state.nonzeroCostSettlementCount === 2;

  const isExactlySettledSuccessPair = (state) =>
    UUID.test(state.generationRequestId ?? "") &&
    state.generationRequestState === "SUCCEEDED" &&
    state.runtimeStage === "COMPLETE" &&
    state.pairPhase === "SETTLED" &&
    state.activeLeaseCount === 0 &&
    state.releasedLeaseCount === 1 &&
    state.assignmentCount === 2 &&
    state.providerTerminalEvidenceCount === 2 &&
    state.exactPairTerminalCount === 0 &&
    state.failedLaneCount === 0 &&
    state.sentOrUnknownOutboxCount === 0 &&
    state.settledEventCount === 2 &&
    state.terminalOutboxCount === 2 &&
    state.terminalTaskCount === 2 &&
    state.conservativeLiabilityUsd !== undefined &&
    usdMicros(state.conservativeLiabilityUsd) === 0 &&
    usdMicros(state.exactItemizedCostUsd) === usdMicros(state.totalSettledCostUsd) &&
    state.zeroCostSettlementCount + state.nonzeroCostSettlementCount === 2 &&
    state.jobs.length === 2 &&
    state.jobs.every(
      (job) =>
        typeof job.jobId === "string" &&
        HASH.test(job.jobIdSha256 ?? "") &&
        job.status === "COMPLETED" &&
        HASH.test(job.terminalProofSha256 ?? "") &&
        job.terminalCostBasis === "exact_execution" &&
        Number.isSafeInteger(job.terminalExecutionTimeMs) &&
        job.terminalExecutionTimeMs >= 0 &&
        usdMicros(job.terminalCostUsd) === usdMicros(job.costUsd),
    );

  const isExactlySuccessCostPendingPair = (state) =>
    UUID.test(state.generationRequestId ?? "") &&
    state.generationRequestState === "SUCCEEDED" &&
    state.runtimeStage === "COMPLETE" &&
    state.pairPhase === "SETTLED" &&
    state.activeLeaseCount === 0 &&
    state.releasedLeaseCount === 1 &&
    state.assignmentCount === 2 &&
    [0, 2].includes(state.providerTerminalEvidenceCount) &&
    state.exactPairTerminalCount === 0 &&
    state.failedLaneCount === 0 &&
    state.sentOrUnknownOutboxCount === 0 &&
    state.settledEventCount === 0 &&
    state.terminalOutboxCount === 2 &&
    state.terminalTaskCount === 2 &&
    usdMicros(state.totalSettledCostUsd) === 0 &&
    usdMicros(state.exactItemizedCostUsd) === 0 &&
    usdMicros(state.conservativeLiabilityUsd) === 0 &&
    state.zeroCostSettlementCount === 0 &&
    state.nonzeroCostSettlementCount === 0 &&
    state.jobs.length === 2 &&
    state.jobs.every(
      (job) =>
        typeof job.jobId === "string" &&
        HASH.test(job.jobIdSha256 ?? "") &&
        job.status === "COMPLETED" &&
        job.rateSource === "V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR" &&
        Number.isFinite(Date.parse(job.rateCheckedAt)) &&
        HASH.test(job.terminalProofSha256 ?? "") &&
        Number.isFinite(Date.parse(job.terminalObservedAt)) &&
        job.terminalCostBasis === null &&
        job.terminalExecutionTimeMs === null &&
        job.terminalCostUsd === null &&
        job.terminalRateCheckedAt === null &&
        job.terminalCostConfidence === null &&
        usdMicros(job.costUsd) === 0,
    );

  operations["reconcile-v209-production-safety"] = async (context) => {
    const { authority, operation, outcome } = context;
    assertAuthorityConfiguration(authority);
    const state = await readCleanupState(authority, operation);
    if (outcome === "SUCCESS") {
      if (state.deployments.length !== 2 || state.deployments.some(({ active }) => active !== true))
        fail("V2_09_CONCRETE_ACTIVE_PRODUCTION_PAIR_INVALID");
      await ports.readbackCloudflareQualified.run({
        ...context,
        cleanupOnly: false,
        operationId: "readback-qualified-production",
      });
      return {
        operation_id: "reconcile-v209-production-safety",
        admission_state: "ACTIVE_QUALIFIED",
        partial_resources_absent: true,
      };
    }
    const cloudflare = await ports.reconcileCloudflareSafety.run({
      ...context,
      cleanupOnly: true,
      operationId: "reconcile-v209-production-safety",
    });
    if (
      cloudflare?.safety_verified !== true ||
      cloudflare?.gpu_transport !== "DISABLED_UNQUALIFIED"
    )
      fail("V2_09_CONCRETE_CLOUDFLARE_RECONCILIATION_INVALID");
    if (state.deployments.length > 0) {
      const output = await exactChild(
        runChild,
        configuration,
        "psql",
        [
          "--no-psqlrc",
          "--set",
          "ON_ERROR_STOP=1",
          "--quiet",
          "--tuples-only",
          "--no-align",
          "--variable",
          `payload_base64=${Buffer.from(
            canonical({
              schemaVersion: "videoforge.v2-09-deactivate-production/v1",
              deploymentIds: state.deployments.map(({ deploymentId }) => deploymentId),
            }),
            "utf8",
          ).toString("base64")}`,
          "--file",
          resolve(ROOT, "deploy/v2-09/neon-deactivate-v209-production.sql"),
        ],
        "DEACTIVATE_PRODUCTION_PAIR",
        {
          cancellationSignal: operation.cancellationSignal,
          env: postgresEnvironmentFor("databaseOwnerUrlFile"),
        },
      );
      const result = parseJson(output, "DEACTIVATE_PRODUCTION_PAIR");
      if (
        result?.schemaVersion !== "videoforge.v2-09-deactivate-production-result/v1" ||
        result.allInactive !== true
      )
        fail("V2_09_CONCRETE_DEACTIVATION_INVALID");
    }
    return {
      operation_id: "reconcile-v209-production-safety",
      admission_state: "DISABLED_CLEAN",
      partial_resources_absent: true,
    };
  };
  operations["reconcile-attributable-runpod-work"] = async ({ authority, operation, outcome }) => {
    let staged = null;
    if (outcome === "FAILURE") {
      staged = await reconcileStagedClick(authority, operation);
      if (staged?.activeCpuWorkCount > 0 || staged?.action === "CPU_CANCEL_PENDING")
        fail("V2_09_CONCRETE_STAGED_CLICK_CPU_CANCEL_PENDING");
      cleanupState = null;
    }
    let state = cleanupState ?? (await readCleanupState(authority, operation));
    let settlement = null;
    let settledSuccessResume = false;
    if (outcome === "SUCCESS") {
      runPodReconciliation = await invokeRunPodReconciliation(
        authority,
        operation,
        "READ_INVENTORY",
        state,
      );
      settlement = await settleSuccessCosts(authority, operation, state, runPodReconciliation);
      // The terminal provider read precedes cost persistence.  Never let later billing consume the
      // cached pre-cost projection.
      state = await readCleanupState(authority, operation);
    } else {
      if (isExactlySuccessCostPendingPair(state)) {
        runPodReconciliation = await invokeRunPodReconciliation(
          authority,
          operation,
          "READ_INVENTORY",
          state,
        );
        settlement = await settleSuccessCosts(authority, operation, state, runPodReconciliation);
        state = await readCleanupState(authority, operation);
        if (!isExactlySettledSuccessPair(state))
          fail("V2_09_CONCRETE_SUCCESS_COST_RECOVERY_INVALID");
        settledSuccessResume = true;
      } else if (isExactlySettledSuccessPair(state)) {
        settledSuccessResume = true;
        settlement = {
          assignmentCount: 2,
          conservativeLiabilityUsd: 0,
          exactItemizedCostUsd: state.exactItemizedCostUsd,
          nonzeroCostSettlementCount: state.nonzeroCostSettlementCount,
          reconciledPairCount: 1,
          terminalOutboxCount: 2,
          totalSettledCostUsd: state.totalSettledCostUsd,
          zeroCostSettlementCount: state.zeroCostSettlementCount,
        };
      } else if (isExactlySettledFailurePair(state)) {
        settlement = {
          assignmentCount: state.assignmentCount,
          conservativeLiabilityUsd: state.conservativeLiabilityUsd,
          exactItemizedCostUsd: state.exactItemizedCostUsd,
          nonzeroCostSettlementCount: state.nonzeroCostSettlementCount,
          reconciledPairCount: 1,
          terminalOutboxCount: state.terminalOutboxCount,
          totalSettledCostUsd: state.totalSettledCostUsd,
          zeroCostSettlementCount: state.zeroCostSettlementCount,
        };
      } else {
        if (staged?.generationAttemptCount === 0) {
          settlement = {
            assignmentCount: 0,
            conservativeLiabilityUsd: 0,
            exactItemizedCostUsd: 0,
            nonzeroCostSettlementCount: 0,
            reconciledPairCount: 0,
            terminalOutboxCount: 0,
            totalSettledCostUsd: 0,
            zeroCostSettlementCount: 0,
          };
        } else {
          terminalJobReconciliation = await invokeRunPodReconciliation(
            authority,
            operation,
            "RECONCILE_TERMINAL_JOBS",
            state,
          );
          const assignedCount = state.jobs.filter(({ jobId }) => typeof jobId === "string").length;
          settlement =
            assignedCount === 0
              ? await reconcileUnassignedAttempts(authority, operation, state)
              : await settleTerminalPair(authority, operation, state, terminalJobReconciliation);
          if (assignedCount > 0) {
            // Provider evidence and DB settlement must be durable before project archival. Re-run
            // the exact staged identity reconciler only after settlement; it may now archive a
            // failed terminal pair, but it can never rewrite a succeeded provider fact.
            const terminalStaged = await reconcileStagedClick(authority, operation);
            if (
              terminalStaged !== null &&
              (terminalStaged.activeCpuWorkCount > 0 ||
                terminalStaged.action !== "PROVIDER_FAILURE_TERMINAL_PROJECT_ARCHIVED")
            )
              fail("V2_09_CONCRETE_STAGED_CLICK_TERMINAL_ARCHIVE_INVALID");
            staged = terminalStaged;
            cleanupState = null;
          }
        }
      }
      runPodReconciliation = await invokeRunPodReconciliation(
        authority,
        operation,
        "DELETE_ATTRIBUTABLE_PAIR",
        state,
        { includeJobs: false },
      );
      state = await readCleanupState(authority, operation);
      if (settledSuccessResume) {
        if (!isExactlySettledSuccessPair(state))
          fail("V2_09_CONCRETE_SUCCESS_RESUME_POSTREAD_INVALID");
      } else {
        assertFailureTerminalPostread(state, settlement);
      }
    }
    const inventory = runPodReconciliation.inventory;
    if (
      inventory.activeWorkers !== 0 ||
      inventory.runningPods !== 0 ||
      inventory.queuedJobs !== 0 ||
      (outcome === "SUCCESS" &&
        JSON.stringify([...inventory.endpointIdSha256s].sort()) !==
          JSON.stringify(
            state.deployments.map(({ endpointIdSha256 }) => endpointIdSha256).sort(),
          )) ||
      (outcome === "FAILURE" && inventory.endpointIdSha256s.length !== 0)
    )
      fail("V2_09_CONCRETE_RUNPOD_NOT_DRAINED");
    return {
      operation_id: "reconcile-attributable-runpod-work",
      active_worker_count: 0,
      queued_job_count: 0,
      in_progress_job_count: 0,
      running_pod_count: 0,
      partial_resources_absent: true,
      production_pair_retained: outcome === "SUCCESS",
    };
  };
  operations["clean-v209-transient-r2"] = async () => ({
    operation_id: "clean-v209-transient-r2",
    // The rollout coordinator never stages an R2 object. Ordinary project artifacts are durable
    // product data and are intentionally outside this cleanup surface.
    transient_keys_absent: true,
  });
  operations["prove-three-zero-compute-reads"] = async ({ authority, operation, outcome }) => {
    const state = cleanupState ?? (await readCleanupState(authority, operation));
    const expectedEndpointIds =
      outcome === "SUCCESS"
        ? state.deployments.map(({ endpointIdSha256 }) => endpointIdSha256).sort()
        : [];
    if (
      outcome === "SUCCESS" &&
      (expectedEndpointIds.length !== 2 || expectedEndpointIds.some((id) => !HASH.test(id ?? "")))
    )
      fail("V2_09_CONCRETE_ZERO_COMPUTE_ENDPOINT_SET_INVALID");
    const reads = [];
    let previousObservedAt = null;
    for (let index = 0; index < 3; index += 1) {
      if (index > 0) await sleep(1_000);
      const observed = await invokeRunPodReconciliation(
        authority,
        operation,
        "READ_INVENTORY",
        state,
        { includeJobs: false },
      );
      const observedEndpointIds = [...observed.inventory.endpointIdSha256s].sort();
      const observedAt = Date.parse(observed.inventory.checkedAt);
      if (
        observed.inventory.activeWorkers !== 0 ||
        observed.inventory.runningPods !== 0 ||
        observed.inventory.queuedJobs !== 0 ||
        !Number.isFinite(observedAt) ||
        (previousObservedAt !== null && observedAt - previousObservedAt < 1_000) ||
        JSON.stringify(observedEndpointIds) !== JSON.stringify(expectedEndpointIds)
      )
        fail("V2_09_CONCRETE_ZERO_COMPUTE_INVALID");
      previousObservedAt = observedAt;
      reads.push({
        observed_at: observed.inventory.checkedAt,
        active_worker_count: 0,
        queued_job_count: 0,
        in_progress_job_count: 0,
        running_pod_count: 0,
        endpoint_id_sha256s: observedEndpointIds,
        attributable_running_pod_id_sha256s: [],
      });
      runPodReconciliation = observed;
    }
    const validatedAt = now();
    if (!(validatedAt instanceof Date) || !Number.isFinite(validatedAt.getTime()))
      fail("V2_09_CONCRETE_CLOCK_INVALID");
    return {
      operation_id: "prove-three-zero-compute-reads",
      zero_compute_read_count: 3,
      reads,
      validated_at: validatedAt.toISOString(),
    };
  };
  operations["read-settled-billing"] = async ({
    authority,
    operation = {},
    outcome,
    priorResults = [],
  }) => {
    const state = cleanupState ?? (await readCleanupState(authority));
    const terminalByLane = new Map(
      (terminalJobReconciliation?.terminal_jobs ?? runPodReconciliation?.terminal_jobs ?? []).map(
        (job) => [job.lane, job],
      ),
    );
    const terminalJobs = state.jobs.flatMap((job) => {
      if (job.jobId === null && job.jobIdSha256 === null) {
        if (
          job.status !== "CANCELLED" ||
          Number(job.costUsd) !== 0 ||
          Number(job.duplicateCostUsd) !== 0 ||
          job.possibleDuplicateExecutions !== 0
        )
          fail("V2_09_CONCRETE_UNASSIGNED_SETTLEMENT_INVALID");
        return [];
      }
      const provider = terminalByLane.get(job.lane);
      const status = provider?.status ?? job.status;
      if (!HASH.test(job.jobIdSha256 ?? "") || typeof status !== "string")
        fail("V2_09_CONCRETE_SETTLEMENT_JOB_INVALID");
      return [
        {
          lane: job.lane,
          job_id_sha256: job.jobIdSha256,
          status,
          cost_usd: Number(job.costUsd),
        },
      ];
    });
    const mageUsd = terminalJobs.find(({ lane }) => lane === "mage")?.cost_usd ?? 0;
    const soulxUsd = terminalJobs.find(({ lane }) => lane === "soulx")?.cost_usd ?? 0;
    const duplicateUsd = state.jobs.reduce((sum, job) => sum + Number(job.duplicateCostUsd), 0);
    const exactItemizedUsd = Number(state.exactItemizedCostUsd);
    const conservativeLiabilityUsd = Number(state.conservativeLiabilityUsd);
    const totalSettledUsd = Number(state.totalSettledCostUsd);
    const e2e = priorResults.find(([id]) => id === "run-one-v209-chrome-e2e")?.[1];
    const e2eCompletionMicros = usdMicros(e2e?.completion_total_usd);
    const completionBaselineMicros = usdMicros(authority.caps.completion_baseline_usd);
    const claimedGenericProjectRevisionNetCostMicros = usdMicros(
      e2e?.generic_project_revision_net_cost_usd,
    );
    if (
      outcome === "SUCCESS" &&
      (terminalJobs.length !== 2 ||
        terminalJobs.some(({ status }) => status !== "COMPLETED") ||
        state.generationRequestState !== "SUCCEEDED" ||
        state.runtimeStage !== "COMPLETE" ||
        state.pairPhase !== "SETTLED" ||
        state.activeLeaseCount !== 0 ||
        state.releasedLeaseCount !== 1 ||
        state.assignmentCount !== 2 ||
        state.providerTerminalEvidenceCount !== 2 ||
        state.sentOrUnknownOutboxCount !== 0 ||
        state.exactPairTerminalCount !== 0 ||
        state.terminalTaskCount !== 2 ||
        state.terminalOutboxCount !== 2 ||
        state.settledEventCount !== 2 ||
        state.failedLaneCount !== 0 ||
        state.zeroCostSettlementCount + state.nonzeroCostSettlementCount !== 2 ||
        usdMicros(conservativeLiabilityUsd) !== 0 ||
        usdMicros(exactItemizedUsd) !== usdMicros(totalSettledUsd) ||
        usdMicros(exactItemizedUsd) !== usdMicros(mageUsd) + usdMicros(soulxUsd) ||
        e2e?.schema_version !== "videoforge.v2-09-one-chrome-e2e-result/v1" ||
        e2e?.operation_id !== "run-one-v209-chrome-e2e" ||
        !HASH.test(e2e?.browser_evidence_sha256 ?? "") ||
        e2e?.generation_request_sha256 !== sha256(state.generationRequestId ?? "") ||
        claimedGenericProjectRevisionNetCostMicros < 0 ||
        e2eCompletionMicros !==
          completionBaselineMicros + claimedGenericProjectRevisionNetCostMicros)
    )
      fail("V2_09_CONCRETE_SUCCESS_SETTLEMENT_NOT_DURABLE");
    const genericProjectRevisionNetCostMicros = await readAttributableGenericProjectCost(
      authority,
      operation,
    );
    if (
      outcome === "SUCCESS" &&
      genericProjectRevisionNetCostMicros !== claimedGenericProjectRevisionNetCostMicros
    )
      fail("V2_09_CONCRETE_SUCCESS_SETTLEMENT_NOT_DURABLE");
    if (
      terminalJobs.some(({ cost_usd }) => !Number.isFinite(cost_usd) || cost_usd < 0) ||
      !Number.isFinite(duplicateUsd) ||
      !Number.isFinite(exactItemizedUsd) ||
      exactItemizedUsd < 0 ||
      !Number.isFinite(conservativeLiabilityUsd) ||
      conservativeLiabilityUsd < 0 ||
      !Number.isFinite(totalSettledUsd) ||
      totalSettledUsd < 0 ||
      usdMicros(exactItemizedUsd) + usdMicros(conservativeLiabilityUsd) !==
        usdMicros(totalSettledUsd) ||
      usdMicros(totalSettledUsd) !== usdMicros(mageUsd) + usdMicros(soulxUsd) ||
      state.jobs.some(({ possibleDuplicateExecutions }) => possibleDuplicateExecutions !== 0)
    )
      fail("V2_09_CONCRETE_SETTLEMENT_COST_INVALID");
    const billingTotal = await readCumulativeRunPodBilling();
    return {
      operation_id: "read-settled-billing",
      settled: true,
      billing_baseline_usd: authority.caps.billing_baseline_usd,
      billing_total_usd: billingTotal,
      completion_total_usd:
        authority.caps.completion_baseline_usd +
        genericProjectRevisionNetCostMicros / 1_000_000 +
        exactItemizedUsd +
        conservativeLiabilityUsd,
      redispatch_count: 0,
      duplicate_compute_usd: duplicateUsd,
      generic_project_revision_net_cost_usd: genericProjectRevisionNetCostMicros / 1_000_000,
      exact_itemized_usd: exactItemizedUsd,
      conservative_liability_usd: conservativeLiabilityUsd,
      terminal_jobs: terminalJobs,
      cost_itemization: { mage_usd: mageUsd, soulx_usd: soulxUsd, total_usd: mageUsd + soulxUsd },
    };
  };
  operations["verify-retained-resources"] = async ({ authority, outcome }) => {
    if (!runPodReconciliation) fail("V2_09_CONCRETE_RETAINED_RESOURCE_READ_MISSING");
    const inventoryVolumes = runPodReconciliation.inventory.volumes;
    const volumes = authority.scope.lanes.map((lane) => {
      const found = inventoryVolumes.find(({ idSha256 }) => idSha256 === lane.volume_id_sha256);
      if (
        !found ||
        found.sizeGb !== lane.volume_size_gb ||
        found.region !== lane.region ||
        found.manifestSha256 !== lane.volume_manifest_sha256
      )
        fail("V2_09_CONCRETE_RETAINED_RESOURCE_DRIFT");
      return {
        lane: lane.lane,
        volume_id_sha256: lane.volume_id_sha256,
        volume_manifest_sha256: lane.volume_manifest_sha256,
        volume_size_gb: lane.volume_size_gb,
        mutated: false,
      };
    });
    if (inventoryVolumes.length !== 2) fail("V2_09_CONCRETE_RETAINED_RESOURCE_DRIFT");
    return {
      operation_id: "verify-retained-resources",
      retained_volume_count: 2,
      retained_volume_mutated: false,
      retained_volume_monthly_usd: 7,
      production_pair_retained: outcome === "SUCCESS",
      volumes,
    };
  };

  for (const operationId of OPERATION_IDS) {
    if (DIRECT_OPERATION_IDS.has(operationId)) continue;
    const portName = PORT_BY_OPERATION[operationId];
    if (!portName || !REQUIRED_CONCRETE_PORTS.includes(portName))
      fail(`V2_09_CONCRETE_OPERATION_UNMAPPED:${operationId}`);
    operations[operationId] = async (context) => {
      assertAuthorityConfiguration(context.authority);
      if (operationId === "upload-cloudflare-production-secrets")
        assertCloudflareSecretInputsUnchanged();
      return ports[portName].run(
        Object.freeze({
          authority: context.authority,
          cleanupOnly: context.cleanupOnly,
          failureOperationId: context.failureOperationId,
          operationId,
          outcome: context.outcome,
          priorResults: context.priorResults,
          providerDeployments: Object.freeze(Object.fromEntries(providerDeployments)),
          ...(operationId.startsWith("create-mage") ? { lane: "mage" } : {}),
          ...(operationId.startsWith("create-soulx") ? { lane: "soulx" } : {}),
          ...(operationId === "upload-cloudflare-production-secrets"
            ? {
                secretInputSha256s: Object.freeze(
                  Object.fromEntries(
                    Object.entries(protectedInputs.cloudflareSecretFiles).map(([name, input]) => [
                      name,
                      input.sha256,
                    ]),
                  ),
                ),
              }
            : {}),
        }),
      );
    };
  }

  if (Object.keys(operations).sort().join(",") !== [...OPERATION_IDS].sort().join(","))
    fail("V2_09_CONCRETE_OPERATION_SET_INVALID");
  const frozenOperations = Object.freeze(operations);
  const sourceIdentity = Object.freeze({
    schema_version: ADAPTER_SOURCE_IDENTITY_SCHEMA,
    implementation_sha256: implementationSha256,
    capability_source_sha256s: Object.freeze({
      ...Object.fromEntries(
        OPERATION_IDS.map((operationId) => [
          operationId,
          DIRECT_OPERATION_IDS.has(operationId)
            ? implementationSha256
            : ports[PORT_BY_OPERATION[operationId]].source_sha256,
        ]),
      ),
      ...Object.fromEntries(STATE_METHODS.map((method) => [method, implementationSha256])),
    }),
  });
  const executionAuthorityId = rehydration?.executionAuthority?.authority_id ?? journalAuthorityId;
  const provisionalState = mapJournalAuthority(
    createJournalState({
      journalPath: configuration.journalPath,
      adapterIdentitySha256: `sha256:${"0".repeat(64)}`,
    }),
    configuration.journalPath,
    journalAuthorityId,
    executionAuthorityId,
    rehydration?.combinedExecution,
  );
  const identitySha256 = deriveInjectedAdapterIdentity({
    operations: frozenOperations,
    source_identity: sourceIdentity,
    state: provisionalState,
  });
  const state = mapJournalAuthority(
    createJournalState({
      journalPath: configuration.journalPath,
      adapterIdentitySha256: identitySha256,
    }),
    configuration.journalPath,
    journalAuthorityId,
    executionAuthorityId,
    rehydration?.combinedExecution,
  );
  if (
    deriveInjectedAdapterIdentity({
      operations: frozenOperations,
      source_identity: sourceIdentity,
      state,
    }) !== identitySha256
  )
    fail("V2_09_CONCRETE_ADAPTER_IDENTITY_UNSTABLE");
  if (deploymentOnly) {
    const first = NORMAL_OPERATIONS.findIndex(
      ({ id }) => id === "render-qualified-production-config",
    );
    const last = NORMAL_OPERATIONS.findIndex(({ id }) => id === "import-v209-qualified-activation");
    const cleanupDeploymentSuffix = async ({ authority, operation = {} }) => {
      assertAuthorityConfiguration(authority);
      const failures = [];
      let cloudflareDisabled = false;
      let databaseDeactivated = false;
      let runPodDeleted = false;
      try {
        const cloudflare = await ports.reconcileCloudflareSafety.run({
          authority,
          cleanupOnly: true,
          operationId: "reconcile-v209-production-safety",
          outcome: "FAILURE",
          priorResults: Object.freeze([]),
          providerDeployments: Object.freeze(Object.fromEntries(providerDeployments)),
        });
        if (
          cloudflare?.safety_verified !== true ||
          cloudflare?.gpu_transport !== "DISABLED_UNQUALIFIED"
        )
          throw new Error("cloudflare cleanup invalid");
        cloudflareDisabled = true;
      } catch {
        failures.push("cloudflare");
      }
      const deploymentIds = ["mage", "soulx"].map(
        (lane) => persistedDeployments.get(lane)?.deploymentId,
      );
      if (deploymentIds.some((id) => !UUID.test(id ?? "")))
        fail("V2_09_DEPLOYMENT_SUFFIX_DATABASE_CLEANUP_INVALID");
      try {
        const output = await exactChild(
          runChild,
          configuration,
          "psql",
          [
            "--no-psqlrc",
            "--set",
            "ON_ERROR_STOP=1",
            "--quiet",
            "--tuples-only",
            "--no-align",
            "--variable",
            `payload_base64=${Buffer.from(
              canonical({
                schemaVersion: "videoforge.v2-09-deactivate-production/v1",
                deploymentIds,
              }),
              "utf8",
            ).toString("base64")}`,
            "--file",
            resolve(ROOT, "deploy/v2-09/neon-deactivate-v209-production.sql"),
          ],
          "DEACTIVATE_PRODUCTION_PAIR",
          {
            cancellationSignal: operation.cancellationSignal,
            env: postgresEnvironmentFor("databaseOwnerUrlFile"),
          },
        );
        const deactivated = parseJson(output, "DEACTIVATE_PRODUCTION_PAIR");
        if (
          deactivated?.schemaVersion !== "videoforge.v2-09-deactivate-production-result/v1" ||
          deactivated.allInactive !== true
        )
          throw new Error("database cleanup invalid");
        databaseDeactivated = true;
      } catch {
        failures.push("database");
      }
      try {
        const observed = await invokeRunPodReconciliation(
          authority,
          operation,
          "DELETE_ATTRIBUTABLE_PAIR",
          { deployments: [], jobs: [] },
          { includeJobs: false },
        );
        if (
          observed.inventory.activeWorkers !== 0 ||
          observed.inventory.runningPods !== 0 ||
          observed.inventory.queuedJobs !== 0 ||
          observed.inventory.endpointIdSha256s.length !== 0
        )
          throw new Error("runpod cleanup invalid");
        runPodDeleted = true;
      } catch {
        failures.push("runpod");
      }
      if (failures.length > 0) fail("V2_09_DEPLOYMENT_SUFFIX_CLEANUP_INCOMPLETE");
      return Object.freeze({
        operation_id: "cleanup-deployment-suffix",
        cloudflare_disabled: cloudflareDisabled,
        database_deactivated: databaseDeactivated,
        endpoint_count: 0,
        active_worker_count: 0,
        running_pod_count: 0,
        queued_job_count: 0,
        runpod_deleted: runPodDeleted,
      });
    };
    return Object.freeze({
      cleanupDeploymentSuffix,
      identity_sha256: identitySha256,
      operations: Object.freeze(
        Object.fromEntries(
          NORMAL_OPERATIONS.slice(first, last + 1).map(({ id }) => [id, operations[id]]),
        ),
      ),
      source_identity: sourceIdentity,
      state,
    });
  }
  if (stagingOnly) {
    const prefixOperationIds = NORMAL_OPERATIONS.slice(
      0,
      NORMAL_OPERATIONS.findIndex(({ id }) => id === "render-qualified-production-config") + 1,
    ).map(({ id }) => id);
    const readPersistedDeploymentBindings = ({ authority, priorResults }) => {
      assertAuthorityConfiguration(authority);
      if (priorResults === null || typeof priorResults !== "object" || Array.isArray(priorResults))
        fail("V2_09_STAGING_DEPLOYMENT_BINDING_INVALID");
      const journal = readJournal(configuration.journalPath);
      if (journal.authority_id !== authority.authority_id || journal.status !== "CLAIMED")
        fail("V2_09_STAGING_DEPLOYMENT_BINDING_INVALID");
      const required = [
        "create-mage-production-lane-max-one",
        "create-soulx-production-lane-max-one",
        "persist-qualified-production-deployments",
      ];
      for (const operationId of required) {
        const result = priorResults[operationId];
        if (
          result === undefined ||
          journal.normal[operationId]?.status !== "COMPLETED" ||
          journal.normal[operationId].result_sha256 !== sha256(canonical(result))
        )
          fail("V2_09_STAGING_DEPLOYMENT_BINDING_INVALID");
      }
      const persisted = priorResults["persist-qualified-production-deployments"];
      if (
        persisted?.operation_id !== "persist-qualified-production-deployments" ||
        persisted.persisted_deployment_count !== 2 ||
        !Array.isArray(persisted.deployments) ||
        persisted.deployments.length !== 2
      )
        fail("V2_09_STAGING_DEPLOYMENT_BINDING_INVALID");
      const bindings = {};
      for (const lane of ["mage", "soulx"]) {
        const deployment = journal.resources[lane];
        const binding = authority.scope?.lanes?.find((entry) => entry.lane === lane);
        const receipt = priorResults[`create-${lane}-production-lane-max-one`];
        const persistedReceipt = persisted.deployments.find((entry) => entry.lane === lane);
        if (
          binding === undefined ||
          typeof deployment?.endpointId !== "string" ||
          deployment.endpointId.length === 0 ||
          sha256(deployment.endpointId) !== deployment.endpointIdSha256 ||
          typeof deployment.templateId !== "string" ||
          deployment.templateId.length === 0 ||
          sha256(deployment.templateId) !== deployment.templateIdSha256 ||
          deployment.sourceCommit !== authority.source_commit ||
          deployment.volumeIdSha256 !== binding.volume_id_sha256 ||
          deployment.volumeManifestSha256 !== binding.volume_manifest_sha256 ||
          receipt?.endpoint_id_sha256 !== deployment.endpointIdSha256 ||
          receipt?.template_id_sha256 !== deployment.templateIdSha256 ||
          receipt?.deployment_sha256 !== deployment.deploymentSha256 ||
          persistedReceipt?.endpoint_id_sha256 !== deployment.endpointIdSha256 ||
          persistedReceipt?.template_id_sha256 !== deployment.templateIdSha256 ||
          persistedReceipt?.deployment_sha256 !== deployment.deploymentSha256 ||
          !HASH.test(persistedReceipt?.deployment_row_id_sha256 ?? "")
        )
          fail("V2_09_STAGING_DEPLOYMENT_BINDING_INVALID");
        bindings[lane] = Object.freeze({
          endpointId: deployment.endpointId,
          endpointIdSha256: deployment.endpointIdSha256,
        });
      }
      return Object.freeze(bindings);
    };
    const cleanupStagedRunPod = async ({ authority, operation = {} }) => {
      assertAuthorityConfiguration(authority);
      const journal = readJournal(configuration.journalPath);
      if (journal.authority_id !== authority.authority_id)
        fail("V2_09_STAGING_RUNPOD_CLEANUP_INVALID");
      const failures = [];
      let databaseDeactivated = false;
      if (
        ["STARTED", "COMPLETED"].includes(
          journal.normal["persist-qualified-production-deployments"]?.status,
        )
      ) {
        const deploymentIds = ["mage", "soulx"].map((lane) =>
          deterministicUuid(`${authority.authority_id}:deployment:${lane}`),
        );
        try {
          const output = await exactChild(
            runChild,
            configuration,
            "psql",
            [
              "--no-psqlrc",
              "--set",
              "ON_ERROR_STOP=1",
              "--quiet",
              "--tuples-only",
              "--no-align",
              "--variable",
              `payload_base64=${Buffer.from(
                canonical({
                  schemaVersion: "videoforge.v2-09-deactivate-production/v1",
                  deploymentIds,
                }),
                "utf8",
              ).toString("base64")}`,
              "--file",
              resolve(ROOT, "deploy/v2-09/neon-deactivate-v209-production.sql"),
            ],
            "DEACTIVATE_PRODUCTION_PAIR",
            {
              cancellationSignal: operation.cancellationSignal,
              env: postgresEnvironmentFor("databaseOwnerUrlFile"),
            },
          );
          const deactivated = parseJson(output, "DEACTIVATE_PRODUCTION_PAIR");
          if (
            deactivated?.schemaVersion !== "videoforge.v2-09-deactivate-production-result/v1" ||
            deactivated.allInactive !== true
          )
            throw new Error("database cleanup invalid");
          databaseDeactivated = true;
        } catch {
          failures.push("database");
        }
      }
      let observed;
      try {
        observed = await invokeRunPodReconciliation(
          authority,
          operation,
          "DELETE_ATTRIBUTABLE_PAIR",
          { deployments: [], jobs: [] },
          { includeJobs: false },
        );
        if (
          observed.inventory.activeWorkers !== 0 ||
          observed.inventory.runningPods !== 0 ||
          observed.inventory.queuedJobs !== 0 ||
          observed.inventory.endpointIdSha256s.length !== 0
        )
          throw new Error("runpod cleanup invalid");
      } catch {
        failures.push("runpod");
      }
      if (failures.length > 0) fail("V2_09_STAGING_CLEANUP_INCOMPLETE");
      return Object.freeze({
        operation_id: "cleanup-staged-runpod",
        database_deactivated: databaseDeactivated,
        endpoint_count: 0,
        active_worker_count: 0,
        running_pod_count: 0,
        queued_job_count: 0,
      });
    };
    return Object.freeze({
      identity_sha256: identitySha256,
      operations: Object.freeze(
        Object.fromEntries(prefixOperationIds.map((id) => [id, frozenOperations[id]])),
      ),
      readPersistedDeploymentBindings,
      cleanupStagedRunPod,
      source_identity: sourceIdentity,
      state,
    });
  }
  return Object.freeze({
    identity_sha256: identitySha256,
    operations: frozenOperations,
    source_identity: sourceIdentity,
    state,
  });
}

export function createConcreteQualifiedProductionAdapters(configuration) {
  const { configuration: snapshot, protectedInputs } =
    snapshotConcreteConfigurationWithHydratedMediaWorker(configuration);
  const ports = createV209BuiltInProductionPorts(snapshot);
  const expectedCloudflareSecretSha256s = Object.fromEntries(
    Object.entries(protectedInputs.cloudflareSecretFiles).map(([name, input]) => [
      name,
      input.sha256,
    ]),
  );
  if (
    canonical(ports.uploadCloudflareSecrets.secret_input_sha256s) !==
    canonical(expectedCloudflareSecretSha256s)
  )
    fail("V2_09_CONCRETE_CLOUDFLARE_SECRET_SNAPSHOT_DRIFT");
  return createConcreteQualifiedProductionAdaptersWithPorts(snapshot, {
    ports,
    protectedInputs,
  });
}

export function createConcreteQualifiedProductionAdaptersForTest(configuration, overrides) {
  if (overrides?.testOnly !== true) fail("V2_09_TEST_ADAPTER_FACTORY_FORBIDDEN");
  const hydrateMediaWorker = overrides?.hydrateMediaWorker === true;
  const prepared = hydrateMediaWorker
    ? snapshotConcreteConfigurationWithHydratedMediaWorker(configuration)
    : { configuration: snapshotConcreteConfiguration(configuration), protectedInputs: null };
  const snapshot = prepared.configuration;
  const testOverrides = { ...overrides };
  delete testOverrides.testOnly;
  delete testOverrides.hydrateMediaWorker;
  if (prepared.protectedInputs) testOverrides.protectedInputs = prepared.protectedInputs;
  if (typeof testOverrides.portsFromHydratedConfiguration === "function") {
    testOverrides.ports = testOverrides.portsFromHydratedConfiguration(snapshot);
    delete testOverrides.portsFromHydratedConfiguration;
  }
  return createConcreteQualifiedProductionAdaptersWithPorts(snapshot, testOverrides);
}

export function createConcreteQualifiedProductionStagingAdapters(configuration) {
  const { configuration: snapshot, protectedInputs } =
    snapshotConcreteConfigurationWithHydratedMediaWorker(configuration, {
      allowDeferredEndpointSecrets: true,
      skipChrome: true,
    });
  return createConcreteQualifiedProductionAdaptersWithPorts(snapshot, {
    ports: createV209StagingPorts(snapshot),
    protectedInputs,
    stagingOnly: true,
  });
}

export function createConcreteQualifiedProductionStagingAdaptersForTest(configuration, overrides) {
  if (overrides?.testOnly !== true) fail("V2_09_TEST_ADAPTER_FACTORY_FORBIDDEN");
  const hydrateMediaWorker = overrides?.hydrateMediaWorker === true;
  const prepared = hydrateMediaWorker
    ? snapshotConcreteConfigurationWithHydratedMediaWorker(configuration, {
        allowDeferredEndpointSecrets: true,
        skipChrome: true,
      })
    : { configuration: snapshotConcreteConfiguration(configuration), protectedInputs: null };
  const snapshot = prepared.configuration;
  const testOverrides = { ...overrides, stagingOnly: true };
  delete testOverrides.testOnly;
  delete testOverrides.hydrateMediaWorker;
  if (prepared.protectedInputs) testOverrides.protectedInputs = prepared.protectedInputs;
  if (typeof testOverrides.portsFromHydratedConfiguration === "function") {
    testOverrides.ports = testOverrides.portsFromHydratedConfiguration(snapshot);
    delete testOverrides.portsFromHydratedConfiguration;
  }
  return createConcreteQualifiedProductionAdaptersWithPorts(snapshot, testOverrides);
}

export function createConcreteQualifiedProductionDeploymentAdapters(configuration, rehydration) {
  const { configuration: snapshot, protectedInputs } =
    snapshotConcreteConfigurationWithHydratedMediaWorker(configuration, { skipChrome: true });
  return createConcreteQualifiedProductionAdaptersWithPorts(snapshot, {
    deploymentOnly: true,
    ports: createV209BuiltInProductionPorts(snapshot),
    protectedInputs,
    rehydration,
  });
}

export function createConcreteQualifiedProductionDeploymentAdaptersForTest(
  configuration,
  overrides,
) {
  if (overrides?.testOnly !== true) fail("V2_09_TEST_ADAPTER_FACTORY_FORBIDDEN");
  const hydrateMediaWorker = overrides?.hydrateMediaWorker === true;
  const prepared = hydrateMediaWorker
    ? snapshotConcreteConfigurationWithHydratedMediaWorker(configuration, { skipChrome: true })
    : { configuration: snapshotConcreteConfiguration(configuration), protectedInputs: null };
  const snapshot = prepared.configuration;
  const testOverrides = { ...overrides, deploymentOnly: true };
  delete testOverrides.testOnly;
  delete testOverrides.hydrateMediaWorker;
  if (prepared.protectedInputs) testOverrides.protectedInputs = prepared.protectedInputs;
  if (typeof testOverrides.portsFromHydratedConfiguration === "function") {
    testOverrides.ports = testOverrides.portsFromHydratedConfiguration(snapshot);
    delete testOverrides.portsFromHydratedConfiguration;
  }
  return createConcreteQualifiedProductionAdaptersWithPorts(snapshot, testOverrides);
}

export function createConcreteQualifiedProductionResumedAdapters(configuration, rehydration) {
  const { configuration: snapshot, protectedInputs } =
    snapshotConcreteConfigurationWithHydratedMediaWorker(configuration);
  const ports = createV209BuiltInProductionPorts(snapshot);
  const expectedCloudflareSecretSha256s = Object.fromEntries(
    Object.entries(protectedInputs.cloudflareSecretFiles).map(([name, input]) => [
      name,
      input.sha256,
    ]),
  );
  if (
    canonical(ports.uploadCloudflareSecrets.secret_input_sha256s) !==
    canonical(expectedCloudflareSecretSha256s)
  )
    fail("V2_09_CONCRETE_CLOUDFLARE_SECRET_SNAPSHOT_DRIFT");
  return createConcreteQualifiedProductionAdaptersWithPorts(snapshot, {
    ports,
    protectedInputs,
    rehydration,
  });
}

export function createConcreteQualifiedProductionResumedAdaptersForTest(configuration, overrides) {
  if (overrides?.testOnly !== true) fail("V2_09_TEST_ADAPTER_FACTORY_FORBIDDEN");
  const hydrateMediaWorker = overrides?.hydrateMediaWorker === true;
  const prepared = hydrateMediaWorker
    ? snapshotConcreteConfigurationWithHydratedMediaWorker(configuration)
    : { configuration: snapshotConcreteConfiguration(configuration), protectedInputs: null };
  const snapshot = prepared.configuration;
  const testOverrides = { ...overrides };
  delete testOverrides.testOnly;
  delete testOverrides.hydrateMediaWorker;
  if (prepared.protectedInputs) testOverrides.protectedInputs = prepared.protectedInputs;
  if (typeof testOverrides.portsFromHydratedConfiguration === "function") {
    testOverrides.ports = testOverrides.portsFromHydratedConfiguration(snapshot);
    delete testOverrides.portsFromHydratedConfiguration;
  }
  return createConcreteQualifiedProductionAdaptersWithPorts(snapshot, testOverrides);
}

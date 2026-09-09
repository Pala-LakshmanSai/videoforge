import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_FRESH_MS = 5 * 60 * 1000;
const MAX_RENEWAL_MS = 24 * 60 * 60 * 1000;
const EXACT_LANES = Object.freeze({
  mage_image: Object.freeze({
    volumeIdSha256: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
    volumeManifestSha256: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  }),
  soulx_avatar: Object.freeze({
    volumeIdSha256: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
    volumeManifestSha256: "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
  }),
});

const fail = (code) => {
  throw new Error(`V2_09_QUALIFIED_RENEWAL_${code}`);
};
const keysAre = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
export const canonicalRenewalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalRenewalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalRenewalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
export const renewalSha256 = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const documentSha256 = (value) => renewalSha256(canonicalRenewalJson(value));

function privateBytes(path, code = "PRIVATE_INPUT") {
  if (!isAbsolute(path)) fail(code);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > 1024 * 1024
    )
      fail(code);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function timestamp(value, nowMs, { future = false, fresh = false } = {}) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail("TIME");
  if (future ? parsed <= nowMs : parsed > nowMs) fail("TIME");
  if (fresh && nowMs - parsed > MAX_FRESH_MS) fail("STALE_PROOF");
  return parsed;
}

function validateLane(lane, expected, renewalLane, retainedLane) {
  if (
    !keysAre(lane, [
      "deploymentId",
      "deploymentSnapshotSha256",
      "isActive",
      "retainedActiveWorkers",
      "workerCountMax",
      "workerCountMin",
    ]) ||
    !UUID.test(lane.deploymentId) ||
    !HASH.test(lane.deploymentSnapshotSha256) ||
    lane.isActive !== true ||
    lane.workerCountMin !== 0 ||
    lane.workerCountMax !== 1 ||
    lane.retainedActiveWorkers !== 0 ||
    renewalLane.deploymentId !== lane.deploymentId ||
    !keysAre(retainedLane, [
      "deploymentId",
      "deploymentSnapshotSha256",
      "volumeIdSha256",
      "volumeManifestSha256",
    ]) ||
    retainedLane.deploymentId !== lane.deploymentId ||
    retainedLane.deploymentSnapshotSha256 !== lane.deploymentSnapshotSha256 ||
    retainedLane.volumeIdSha256 !== expected.volumeIdSha256 ||
    retainedLane.volumeManifestSha256 !== expected.volumeManifestSha256
  )
    fail("RUNPOD_IDENTITY");
}

export function validateExpiredQualifiedActivationRenewal(input, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) fail("CLOCK");
  if (
    !keysAre(input, [
      "cloudflareReadback",
      "cloudflareReadbackSha256",
      "databaseCredentialPath",
      "expiresAt",
      "issuedAt",
      "journalPath",
      "payload",
      "retainedBindings",
      "schemaVersion",
    ]) ||
    input.schemaVersion !== "videoforge.v2-09-expired-qualified-activation-renewal-operator/v1" ||
    !isAbsolute(input.databaseCredentialPath) ||
    !isAbsolute(input.journalPath) ||
    !HASH.test(input.cloudflareReadbackSha256 ?? "")
  )
    fail("INPUT");
  const issuedMs = timestamp(input.issuedAt, nowMs);
  const expiresMs = timestamp(input.expiresAt, nowMs, { future: true });
  if (nowMs - issuedMs > MAX_FRESH_MS || expiresMs - issuedMs > MAX_RENEWAL_MS) fail("DEADLINE");

  const renewal = input.payload;
  if (
    !keysAre(renewal, [
      "activationId",
      "cloudflareVersionIdSha256",
      "deployedConfigSha256",
      "inventoryEvidence",
      "inventoryEvidenceSha256",
      "lanes",
      "previousActivationId",
      "readbackSha256",
      "refreshId",
      "schemaVersion",
      "sourceCommit",
    ]) ||
    renewal.schemaVersion !== "videoforge.hosted-v209-expired-qualification-refresh/v1" ||
    !UUID.test(renewal.refreshId ?? "") ||
    !UUID.test(renewal.previousActivationId ?? "") ||
    !UUID.test(renewal.activationId ?? "") ||
    renewal.activationId === renewal.previousActivationId ||
    !COMMIT.test(renewal.sourceCommit ?? "") ||
    !HASH.test(renewal.cloudflareVersionIdSha256 ?? "") ||
    !HASH.test(renewal.deployedConfigSha256 ?? "") ||
    !HASH.test(renewal.readbackSha256 ?? "") ||
    !HASH.test(renewal.inventoryEvidenceSha256 ?? "") ||
    !keysAre(renewal.lanes, ["mage_image", "soulx_avatar"])
  )
    fail("RENEWAL_IDENTITY");

  const inventory = renewal.inventoryEvidence;
  if (
    documentSha256(inventory) !== renewal.inventoryEvidenceSha256 ||
    !keysAre(inventory, [
      "cloudflareVersionIdSha256",
      "deployedConfigSha256",
      "lanes",
      "observationKind",
      "observedAt",
      "providerActionsCreated",
      "providerMutationObserved",
      "readbackSha256",
      "schemaVersion",
      "sourceCommit",
    ]) ||
    inventory.schemaVersion !== "videoforge.hosted-v209-read-only-provider-inventory/v1" ||
    inventory.observationKind !== "READ_ONLY_PROVIDER_INVENTORY" ||
    inventory.providerActionsCreated !== 0 ||
    inventory.providerMutationObserved !== false ||
    inventory.sourceCommit !== renewal.sourceCommit ||
    inventory.cloudflareVersionIdSha256 !== renewal.cloudflareVersionIdSha256 ||
    inventory.deployedConfigSha256 !== renewal.deployedConfigSha256 ||
    inventory.readbackSha256 !== renewal.readbackSha256 ||
    !keysAre(inventory.lanes, ["mage_image", "soulx_avatar"])
  )
    fail("RUNPOD_PROOF");
  timestamp(inventory.observedAt, nowMs, { fresh: true });

  const cloudflare = input.cloudflareReadback;
  if (
    documentSha256(cloudflare) !== input.cloudflareReadbackSha256 ||
    !keysAre(cloudflare, [
      "deployedConfigSha256",
      "observedAt",
      "readbackSha256",
      "sourceCommit",
      "sourceSha256",
      "versionIdSha256",
      "workerName",
    ]) ||
    cloudflare.workerName !== "videoforge-production-runtime" ||
    !COMMIT.test(cloudflare.sourceCommit ?? "") ||
    !HASH.test(cloudflare.sourceSha256 ?? "") ||
    !HASH.test(cloudflare.versionIdSha256 ?? "") ||
    !HASH.test(cloudflare.deployedConfigSha256 ?? "") ||
    !HASH.test(cloudflare.readbackSha256 ?? "")
  )
    fail("CLOUDFLARE_PROOF");
  timestamp(cloudflare.observedAt, nowMs, { fresh: true });
  if (
    renewal.sourceCommit !== cloudflare.sourceCommit ||
    renewal.cloudflareVersionIdSha256 !== cloudflare.versionIdSha256 ||
    renewal.deployedConfigSha256 !== cloudflare.deployedConfigSha256 ||
    renewal.readbackSha256 !== cloudflare.readbackSha256 ||
    inventory.observedAt !== cloudflare.observedAt ||
    !keysAre(input.retainedBindings, ["mage_image", "soulx_avatar"])
  )
    fail("CLOUDFLARE_IDENTITY");
  const renewalIds = [renewal.refreshId, renewal.activationId];
  for (const [name, exact] of Object.entries(EXACT_LANES)) {
    const lane = renewal.lanes[name];
    if (
      !keysAre(lane, ["deploymentId", "previousQualificationId", "qualificationId"]) ||
      !UUID.test(lane.deploymentId ?? "") ||
      !UUID.test(lane.previousQualificationId ?? "") ||
      !UUID.test(lane.qualificationId ?? "") ||
      lane.qualificationId === lane.previousQualificationId
    )
      fail("NEW_IDS");
    renewalIds.push(lane.qualificationId);
    validateLane(inventory.lanes[name], exact, lane, input.retainedBindings[name]);
  }
  const previousIds = [
    renewal.previousActivationId,
    renewal.lanes.mage_image.previousQualificationId,
    renewal.lanes.soulx_avatar.previousQualificationId,
  ];
  if (
    new Set(renewalIds).size !== renewalIds.length ||
    new Set(previousIds).size !== previousIds.length ||
    renewalIds.some((id) => previousIds.includes(id))
  )
    fail("NEW_IDS");
  return renewal;
}

export function renderExpiredQualifiedActivationRenewalSql(renewal) {
  const payload = Buffer.from(canonicalRenewalJson(renewal), "utf8").toString("base64");
  return [
    "\\set ON_ERROR_STOP on",
    "BEGIN;",
    "SELECT public.videoforge_refresh_hosted_v209_expired_qualification(",
    `  convert_from(decode('${payload}','base64'),'UTF8')::jsonb`,
    ");",
    "COMMIT;",
    "",
  ].join("\n");
}

function databaseEnvironment(credentialPath) {
  const url = new URL(privateBytes(credentialPath, "DATABASE_CREDENTIAL").toString("utf8").trim());
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.searchParams.get("sslmode") !== "require" ||
    url.searchParams.get("channel_binding") !== "require"
  )
    fail("DATABASE_IDENTITY");
  return {
    PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: "require",
    PGCHANNELBINDING: "require",
    PGCONNECT_TIMEOUT: "15",
  };
}

function defaultRunDatabase({ sql, env }) {
  return spawnSync(
    "/opt/homebrew/opt/libpq/bin/psql",
    ["--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1"],
    {
      input: sql,
      encoding: "utf8",
      env,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}

/** One fsynced intent, one PostgreSQL process, and never an automatic retry. */
export function executeRenewExpiredQualifiedActivation({
  inputPath,
  expectedInputSha256,
  now = new Date(),
  runDatabase = defaultRunDatabase,
}) {
  const inputBytes = privateBytes(inputPath);
  if (renewalSha256(inputBytes) !== expectedInputSha256) fail("INPUT_HASH");
  const input = JSON.parse(inputBytes);
  const renewal = validateExpiredQualifiedActivationRenewal(input, now);
  const sql = renderExpiredQualifiedActivationRenewalSql(renewal);
  const env = databaseEnvironment(input.databaseCredentialPath);
  const directoryStat = lstatSync(dirname(input.journalPath));
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    directoryStat.uid !== process.getuid() ||
    (directoryStat.mode & 0o077) !== 0
  )
    fail("JOURNAL_DIRECTORY");
  const fd = openSync(
    input.journalPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  const record = (value) => {
    writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fsyncSync(fd);
  };
  try {
    record({
      operation: "RENEW_EXPIRED_QUALIFIED_ACTIVATION",
      status: "INTENT",
      input_sha256: expectedInputSha256,
      renewal_sha256: documentSha256(renewal),
      sql_sha256: renewalSha256(sql),
      at: now.toISOString(),
    });
    const directory = openSync(dirname(input.journalPath), constants.O_RDONLY);
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
    let result;
    try {
      result = runDatabase({ sql, env });
    } catch (error) {
      result = { error, status: null, stderr: "" };
    }
    if (result?.error || result?.status !== 0) {
      record({
        operation: "RENEW_EXPIRED_QUALIFIED_ACTIVATION",
        status: "UNKNOWN_NO_RETRY",
        diagnostic_sha256: renewalSha256(result?.stderr ?? ""),
        exit_code: result?.status ?? null,
        at: new Date().toISOString(),
      });
      fail("EXECUTION_UNCERTAIN");
    }
    let parsed;
    try {
      parsed = JSON.parse(String(result.stdout).trim());
    } catch {
      parsed = null;
    }
    if (
      parsed?.schemaVersion !== "videoforge.hosted-v209-expired-qualification-refresh-result/v1" ||
      parsed.refreshId !== renewal.refreshId ||
      parsed.activationId !== renewal.activationId ||
      parsed.mageQualificationId !== renewal.lanes.mage_image.qualificationId ||
      parsed.soulxQualificationId !== renewal.lanes.soulx_avatar.qualificationId ||
      parsed.providerActionsCreated !== 0 ||
      parsed.replayed !== false ||
      parsed.inventoryEvidenceSha256 !== renewal.inventoryEvidenceSha256 ||
      !Number.isFinite(Date.parse(parsed.qualificationExpiresAt)) ||
      Date.parse(parsed.qualificationExpiresAt) <= now.getTime() ||
      Date.parse(parsed.qualificationExpiresAt) - now.getTime() > MAX_RENEWAL_MS
    ) {
      record({
        operation: "RENEW_EXPIRED_QUALIFIED_ACTIVATION",
        status: "UNKNOWN_NO_RETRY",
        diagnostic_sha256: renewalSha256(result.stdout ?? ""),
        exit_code: result.status,
        at: new Date().toISOString(),
      });
      fail("RESULT_UNCERTAIN");
    }
    record({
      operation: "RENEW_EXPIRED_QUALIFIED_ACTIVATION",
      status: "COMMITTED",
      result_sha256: documentSha256(parsed),
      at: new Date().toISOString(),
    });
    return parsed;
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 4 || !HASH.test(process.argv[3] ?? "")) fail("CLI");
  process.stdout.write(
    `${canonicalRenewalJson(
      executeRenewExpiredQualifiedActivation({
        inputPath: process.argv[2],
        expectedInputSha256: process.argv[3],
      }),
    )}\n`,
  );
}

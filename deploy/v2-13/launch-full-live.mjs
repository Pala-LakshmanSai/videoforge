#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  CONFIRMATION as AUTHORITY_CONFIRMATION,
  validateAuthorityRecordCommit,
  validateMaterializationSeedFile,
  validateOuterAuthority,
  validateStaticReleaseDescriptorFile,
} from "./full-live-orchestration-authority.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LAUNCH_CONFIRMATION = "LAUNCH_EXACT_V2_13_FULL_LIVE_ONCE";
const EXECUTOR_CONFIRMATION = "EXECUTE_EXACT_V2_13_FULL_LIVE_ONCE";
const HASH = /^sha256:[0-9a-f]{64}$/u;
const AUTHORITY_ID = /^v2-13-[a-z0-9][a-z0-9._-]{7,95}$/u;

const SOURCE_HASHES = Object.freeze({
  credentialBootstrapReceipt:
    "sha256:35caf042a18f6f4b42f264d96e52926856bcc387890c4925f512f2bf2c6c1eab",
  googleClientId: "sha256:0150569d559bc69055805f48be9d54e9748a1fa34e6dffa6c293701b9814d932",
  googleClientSecret: "sha256:c4d12264294b3275aebe6b8a51eb5a9f4a5a599c7694f48bcf8ba4422c8c6cfb",
  r2AccessKeyId: "sha256:a322bcb37f84d28ddd0fd841f0eb3ad2feaf368f71c21deece4f9d1f8433e335",
  r2SecretAccessKey: "sha256:227e83b53468d6053b983a844473e04cbde8eff81c27b499127f106c394a900e",
  runpodApiKey: "sha256:8cd1f17f592f8013cd6ce66e0230f4b6093dba972318b18b7fb1b87a713653e9",
  ownerPgService: "sha256:a229e31f04598c23c6921c002ba88fa4b6a64036c3366844ad64ad9919bd84e0",
  ownerPgpass: "sha256:41213ad8b2e6c7793aef16b95209464bbf90df017966524bf8bf39f9c80f50d5",
});
const WRANGLER_OAUTH_PATH_SHA256 =
  "sha256:1f4cc7dea1b7ea98aaf91bae95b329dfd607a26967ba15f6813e26340f96961c";

const ENVIRONMENT_NAMES = Object.freeze([
  "VIDEOFORGE_V2_13_ACTIVATION_EVIDENCE_OUTPUT",
  "VIDEOFORGE_V2_13_ACTIVATION_RECORD",
  "VIDEOFORGE_V2_13_CANCELLATION_RECORD_FILE",
  "VIDEOFORGE_V2_13_CLEANUP_INPUT_FILE",
  "VIDEOFORGE_V2_13_CONFIG_ACTIVATION_RECORD",
  "VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE",
  "VIDEOFORGE_V2_13_DISABLED_CONFIG_FILE",
  "VIDEOFORGE_V2_13_GOOGLE_CLIENT_ID_FILE",
  "VIDEOFORGE_V2_13_GOOGLE_CLIENT_SECRET_FILE",
  "VIDEOFORGE_V2_13_MATERIALIZATION_CHAIN_FILE",
  "VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE",
  "VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE",
  "VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR",
  "VIDEOFORGE_V2_13_POST_CONSUMPTION_MATERIALIZATION_FILE",
  "VIDEOFORGE_V2_13_PREQUALIFICATION_DATABASE_BOOTSTRAP_RECEIPT_FILE",
  "VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE",
  "VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE",
  "VIDEOFORGE_V2_13_PRODUCTION_SECRET_BOOTSTRAP_FILE",
  "VIDEOFORGE_V2_13_PROMOTION_RECORD_FILE",
  "VIDEOFORGE_V2_13_PROPOSAL_FILE",
  "VIDEOFORGE_V2_13_R2_ACCESS_KEY_ID_FILE",
  "VIDEOFORGE_V2_13_R2_SECRET_ACCESS_KEY_FILE",
  "VIDEOFORGE_V2_13_RECONCILER_DATABASE_URL_FILE",
  "VIDEOFORGE_V2_13_RELEASE_MANIFEST_FILE",
  "VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE",
  "VIDEOFORGE_V2_13_RUNTIME_DATABASE_URL_FILE",
  "VIDEOFORGE_V2_13_SECRET_INPUT_DIR",
  "VIDEOFORGE_V2_13_STATIC_RELEASE_DESCRIPTOR_FILE",
  "VIDEOFORGE_V2_13_USER_APPROVAL_FILE",
  "VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE",
  "VIDEOFORGE_V2_13_WORKER_ORIGIN_FILE",
  "VIDEOFORGE_V2_13_WRANGLER_OAUTH_CONFIG_FILE",
]);

const fail = (code, detail = "") => {
  throw new Error(`V2_13_FULL_LIVE_LAUNCH_${code}${detail ? `:${detail}` : ""}`);
};
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const SAFE_INHERITED_ENV_NAMES = Object.freeze([
  "CI",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "PATH",
  "PNPM_HOME",
  "TMPDIR",
  "TZ",
  "USER",
]);

const CONTROL_INPUT_NAMES = Object.freeze([
  "proposal",
  "approval",
  "authority",
  "materializationSeed",
  "staticReleaseDescriptor",
  "wranglerOAuthConfig",
]);

const SOURCE_INPUT_NAMES = Object.freeze([
  "credentialBootstrapReceipt",
  "googleClientId",
  "googleClientSecret",
  "r2AccessKeyId",
  "r2SecretAccessKey",
  "runpodApiKey",
  "ownerPgService",
  "ownerPgpass",
]);

const STAGED_SOURCE_NAMES = Object.freeze({
  proposal: "proposal.json",
  approval: "user-approval.json",
  authority: "approved-authority.json",
  materializationSeed: "materialization-seed.json",
  staticReleaseDescriptor: "static-release-descriptor.json",
  wranglerOAuthConfig: "wrangler-oauth-config.toml",
  credentialBootstrapReceipt: "credential-bootstrap.json",
  googleClientId: "GOOGLE_CLIENT_ID",
  googleClientSecret: "GOOGLE_CLIENT_SECRET",
  r2AccessKeyId: "R2_ACCESS_KEY_ID",
  r2SecretAccessKey: "R2_SECRET_ACCESS_KEY",
  runpodApiKey: "RUNPOD_API_KEY",
});

const STAGED_POSTGRES_NAMES = Object.freeze({
  ownerPgService: "owner.pg_service.conf",
  ownerPgpass: "owner.pgpass",
});

const ARTIFACT_OUTPUT_NAMES = Object.freeze([
  "activation-evidence.json",
  "activation-record.json",
  "cancellation-record.json",
  "cleanup-input.json",
  "config-activation-record.json",
  "disabled-config.json",
  "materialization-chain.json",
  "post-consumption-materialization.json",
  "production-input.json",
  "production-secrets.json",
  "production-secret-bootstrap.json",
  "promotion-record.json",
  "release-manifest.json",
  "worker-operator-bearer",
  "worker-origin",
]);

const POSTGRES_OUTPUT_NAMES = Object.freeze([
  "database-role-credentials.json",
  "operator.database-url",
  "prequalification-database-bootstrap.json",
  "reconciler.database-url",
  "runtime.database-url",
]);

// These are the only secret-input names materialized after database bootstrap. Endpoint identity
// files are also declared up front so a stale prior attempt cannot satisfy a new authority.
const SECRET_OUTPUT_NAMES = Object.freeze([
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "WORKFLOW_CALLBACK_SECRET",
  "MEDIA_WORKER_TOKEN_SECRET",
  "VIDEOFORGE_RECONCILER_DATABASE_URL",
  "VIDEOFORGE_DISPATCH_TOKEN_KEY",
  "VIDEOFORGE_DISPATCH_TOKEN_KEY_ID",
  "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX",
  "VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID",
  "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
  "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
  "RUNPOD_API_KEY",
  "RUNPOD_API_BASE_URL",
  "VIDEOFORGE_MAGE_ENDPOINT_ID",
  "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
  "VIDEOFORGE_SOULX_ENDPOINT_ID",
  "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
  "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN",
]);

function exactFile(path, code) {
  if (typeof path !== "string" || path === "" || !path.startsWith("/") || path.includes("\0"))
    fail(code);
  try {
    const metadata = lstatSync(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o600 ||
      realpathSync(path) !== realpathSync(resolve(path))
    )
      fail(code);
    return metadata;
  } catch (error) {
    if (error instanceof Error && error.message === `V2_13_FULL_LIVE_LAUNCH_${code}`) throw error;
    fail(code);
  }
}

function exactDirectory(path, code) {
  if (typeof path !== "string" || path === "" || !path.startsWith("/") || path.includes("\0"))
    fail(code);
  try {
    const metadata = lstatSync(path);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o700 ||
      realpathSync(path) !== realpathSync(resolve(path))
    )
      fail(code);
    return metadata;
  } catch (error) {
    if (error instanceof Error && error.message === `V2_13_FULL_LIVE_LAUNCH_${code}`) throw error;
    fail(code);
  }
}

function stableProtectedBytes(path, expectedSha256, code) {
  const beforePath = exactFile(path, code);
  let descriptor;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail(code);
  }
  try {
    const before = lstatSync(path);
    const descriptorBefore = fstatSync(descriptor);
    if (
      before.dev !== beforePath.dev ||
      before.ino !== beforePath.ino ||
      descriptorBefore.dev !== before.dev ||
      descriptorBefore.ino !== before.ino
    )
      fail(`${code}_RACE`);
    const bytes = readFileSync(descriptor);
    const descriptorAfter = fstatSync(descriptor);
    const after = lstatSync(path);
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      descriptorAfter.dev !== before.dev ||
      descriptorAfter.ino !== before.ino ||
      descriptorAfter.size !== before.size
    )
      fail(`${code}_RACE`);
    const actualSha256 = sha256(bytes);
    if (expectedSha256 !== undefined && actualSha256 !== expectedSha256) fail(`${code}_HASH`);
    return { bytes, sha256: actualSha256, metadata: before };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_LAUNCH_")) throw error;
    fail(code);
  } finally {
    closeSync(descriptor);
  }
}

function makeExactDirectory(path, code) {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && error.code === "EEXIST")) fail(code);
  }
  exactDirectory(path, code);
}

function copyStableSource({ source, destination, expectedSha256, code }) {
  const observed = stableProtectedBytes(source, expectedSha256, `${code}_SOURCE`);
  let descriptor;
  try {
    descriptor = openSync(
      destination,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    fchmodSync(descriptor, 0o600);
    if (writeSync(descriptor, observed.bytes) !== observed.bytes.length) fail(`${code}_COPY`);
    fsyncSync(descriptor);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_13_FULL_LIVE_LAUNCH_")) throw error;
    fail(`${code}_COPY`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  const copied = stableProtectedBytes(destination, expectedSha256, `${code}_COPY`);
  if (
    copied.metadata.dev === observed.metadata.dev &&
    copied.metadata.ino === observed.metadata.ino
  )
    fail(`${code}_ALIAS`);
  return destination;
}

function exactInventory(directory, expected, code) {
  const actual = readdirSync(directory).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) fail(code);
}

function absoluteInputPath(value, code) {
  if (
    typeof value !== "string" ||
    value === "" ||
    !value.startsWith("/") ||
    value.includes("\0") ||
    resolve(value) !== value
  )
    fail(code);
  return value;
}

function pathIsWithin(parent, child) {
  const suffix = relative(resolve(parent), resolve(child));
  return (
    suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep))
  );
}

function rejectArchivePath(path, code) {
  const parts = resolve(path).split(sep);
  if (parts.includes("history") || parts.includes("archive") || parts.includes("archives"))
    fail(code);
}

function requireAbsent(path, code) {
  try {
    lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    fail(code);
  }
  fail(code);
}

function validateLaunchInputMetadata({
  proposalFile,
  approvalFile,
  authorityFile,
  materializationSeedFile,
  staticReleaseDescriptorFile,
  wranglerOAuthConfigFile,
  sourceFiles,
}) {
  const controlPaths = {
    proposal: proposalFile,
    approval: approvalFile,
    authority: authorityFile,
    materializationSeed: materializationSeedFile,
    staticReleaseDescriptor: staticReleaseDescriptorFile,
    wranglerOAuthConfig: wranglerOAuthConfigFile,
  };
  if (
    JSON.stringify(Object.keys(controlPaths).sort()) !==
    JSON.stringify([...CONTROL_INPUT_NAMES].sort())
  )
    fail("INPUT_CONTROL_SET");
  if (
    JSON.stringify(Object.keys(sourceFiles ?? {}).sort()) !==
    JSON.stringify([...SOURCE_INPUT_NAMES].sort())
  )
    fail("INPUT_SOURCE_SET");
  for (const [name, path] of Object.entries(controlPaths))
    exactFile(
      absoluteInputPath(path, `INPUT_PATH_${name.toUpperCase()}`),
      `INPUT_${name.toUpperCase()}`,
    );
  for (const [name, path] of Object.entries(sourceFiles ?? {}))
    exactFile(
      absoluteInputPath(path, `SOURCE_PATH_${name.toUpperCase()}`),
      `SOURCE_${name.toUpperCase()}`,
    );
  return Object.freeze({ controlPaths: Object.freeze(controlPaths), sourceFiles });
}

function stagePathFor(attemptRoot, directory, name) {
  const path = join(attemptRoot, directory, name);
  if (resolve(dirname(path)) !== resolve(join(attemptRoot, directory))) fail("STAGE_PATH");
  return path;
}

function databaseCredentialStagePath(path, authorityId) {
  const binding = sha256(Buffer.from(`${authorityId}\0${resolve(path)}`)).slice(
    "sha256:".length,
    31,
  );
  return join(dirname(path), `.${basename(path)}.${binding}.v213-stage`);
}

function buildFutureOutputTargets({ attemptRoot, authorityId }) {
  const artifactsDirectory = join(attemptRoot, "artifacts");
  const postgresDirectory = join(attemptRoot, "postgres-inputs");
  const secretDirectory = join(attemptRoot, "secret-inputs");
  const stateFile = join(attemptRoot, "full-live-state.json");
  const postgresFiles = POSTGRES_OUTPUT_NAMES.map((name) => join(postgresDirectory, name));
  const databaseCredentialFinals = [
    join(postgresDirectory, "database-role-credentials.json"),
    join(postgresDirectory, "operator.database-url"),
    join(postgresDirectory, "runtime.database-url"),
    join(postgresDirectory, "reconciler.database-url"),
    join(secretDirectory, "DATABASE_URL"),
    join(secretDirectory, "VIDEOFORGE_RECONCILER_DATABASE_URL"),
  ];
  const stageFiles = databaseCredentialFinals.map((path) =>
    databaseCredentialStagePath(path, authorityId),
  );
  const paths = [
    stateFile,
    `${stateFile}.lock`,
    `${stateFile}.next`,
    `${stateFile}.execution-lease`,
    `${stateFile}.cancellation.json`,
    ...ARTIFACT_OUTPUT_NAMES.map((name) => join(artifactsDirectory, name)),
    ...postgresFiles,
    ...stageFiles,
    ...SECRET_OUTPUT_NAMES.map((name) => join(secretDirectory, name)),
  ].map((path) => resolve(path));
  if (new Set(paths).size !== paths.length) fail("OUTPUT_PATH_COLLISION");
  return Object.freeze(paths);
}

function buildClosedEnvironment({
  postgresDirectory,
  secretDirectory,
  artifactsDirectory,
  staged,
  baseEnvironment = process.env,
}) {
  const output = (name) => join(artifactsDirectory, name);
  const environment = Object.fromEntries(
    SAFE_INHERITED_ENV_NAMES.filter((name) => typeof baseEnvironment[name] === "string").map(
      (name) => [name, baseEnvironment[name]],
    ),
  );
  Object.assign(environment, {
    VIDEOFORGE_V2_13_ACTIVATION_EVIDENCE_OUTPUT: output("activation-evidence.json"),
    VIDEOFORGE_V2_13_ACTIVATION_RECORD: output("activation-record.json"),
    VIDEOFORGE_V2_13_CANCELLATION_RECORD_FILE: output("cancellation-record.json"),
    VIDEOFORGE_V2_13_CLEANUP_INPUT_FILE: output("cleanup-input.json"),
    VIDEOFORGE_V2_13_CONFIG_ACTIVATION_RECORD: output("config-activation-record.json"),
    VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE: staged.credentialBootstrapReceipt,
    VIDEOFORGE_V2_13_DISABLED_CONFIG_FILE: output("disabled-config.json"),
    VIDEOFORGE_V2_13_GOOGLE_CLIENT_ID_FILE: staged.googleClientId,
    VIDEOFORGE_V2_13_GOOGLE_CLIENT_SECRET_FILE: staged.googleClientSecret,
    VIDEOFORGE_V2_13_MATERIALIZATION_CHAIN_FILE: output("materialization-chain.json"),
    VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE: staged.materializationSeed,
    VIDEOFORGE_V2_13_OPERATOR_DATABASE_URL_FILE: join(postgresDirectory, "operator.database-url"),
    VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR: postgresDirectory,
    VIDEOFORGE_V2_13_POST_CONSUMPTION_MATERIALIZATION_FILE: output(
      "post-consumption-materialization.json",
    ),
    VIDEOFORGE_V2_13_PREQUALIFICATION_DATABASE_BOOTSTRAP_RECEIPT_FILE: join(
      postgresDirectory,
      "prequalification-database-bootstrap.json",
    ),
    VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE: output("production-input.json"),
    VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE: output("production-secrets.json"),
    VIDEOFORGE_V2_13_PRODUCTION_SECRET_BOOTSTRAP_FILE: output("production-secret-bootstrap.json"),
    VIDEOFORGE_V2_13_PROMOTION_RECORD_FILE: output("promotion-record.json"),
    VIDEOFORGE_V2_13_PROPOSAL_FILE: staged.proposal,
    VIDEOFORGE_V2_13_R2_ACCESS_KEY_ID_FILE: staged.r2AccessKeyId,
    VIDEOFORGE_V2_13_R2_SECRET_ACCESS_KEY_FILE: staged.r2SecretAccessKey,
    VIDEOFORGE_V2_13_RECONCILER_DATABASE_URL_FILE: join(
      postgresDirectory,
      "reconciler.database-url",
    ),
    VIDEOFORGE_V2_13_RELEASE_MANIFEST_FILE: output("release-manifest.json"),
    VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE: staged.runpodApiKey,
    VIDEOFORGE_V2_13_RUNTIME_DATABASE_URL_FILE: join(postgresDirectory, "runtime.database-url"),
    VIDEOFORGE_V2_13_SECRET_INPUT_DIR: secretDirectory,
    VIDEOFORGE_V2_13_STATIC_RELEASE_DESCRIPTOR_FILE: staged.staticReleaseDescriptor,
    VIDEOFORGE_V2_13_USER_APPROVAL_FILE: staged.approval,
    VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE: output("worker-operator-bearer"),
    VIDEOFORGE_V2_13_WORKER_ORIGIN_FILE: output("worker-origin"),
    VIDEOFORGE_V2_13_WRANGLER_OAUTH_CONFIG_FILE: staged.wranglerOAuthConfig,
  });
  assertClosedEnvironment(environment);
  return Object.freeze(environment);
}

function validateAuthorityInputs({
  proposalFile,
  approvalFile,
  authorityFile,
  authorityRecordCommit,
  materializationSeedFile,
  staticReleaseDescriptorFile,
}) {
  const proposal = stableProtectedBytes(proposalFile, undefined, "PROPOSAL_FILE");
  const approval = stableProtectedBytes(approvalFile, undefined, "APPROVAL_FILE");
  const authorityRecord = stableProtectedBytes(authorityFile, undefined, "AUTHORITY_FILE");
  const proposalBytes = proposal.bytes;
  const approvalBytes = approval.bytes;
  const authorityBytes = authorityRecord.bytes;
  const { authority, validated } = validateOuterAuthority({
    proposalBytes,
    approvalBytes,
    authorityBytes,
  });
  if (
    sha256(proposalBytes) !== authority.lineage?.proposal_sha256 ||
    sha256(approvalBytes) !== authority.lineage?.user_approval_sha256
  )
    fail("AUTHORITY_INPUT_HASH");
  validateAuthorityRecordCommit({
    authority,
    approvalBytes,
    authorityBytes,
    authorityRecordCommit,
  });
  validateStaticReleaseDescriptorFile({
    path: staticReleaseDescriptorFile,
    expectedSha256: authority.static_release_descriptor?.sha256,
    expectedSourceCommit: validated.releaseSourceCommit,
  });
  validateMaterializationSeedFile({
    path: materializationSeedFile,
    expectedSha256: authority.materialization_seed_sha256,
    expectedFullLiveAuthorityId: authority.full_live_authority_id,
    expectedReleaseSourceCommit: validated.releaseSourceCommit,
  });
  if (!AUTHORITY_ID.test(authority.authority_id ?? "")) fail("AUTHORITY_ID");
  return Object.freeze({
    authority,
    validated,
    inputHashes: Object.freeze({
      proposal: proposal.sha256,
      approval: approval.sha256,
      authority: authorityRecord.sha256,
      materializationSeed: authority.materialization_seed_sha256,
      staticReleaseDescriptor: authority.static_release_descriptor.sha256,
      wranglerOAuthConfig: undefined,
    }),
  });
}

function assertClosedEnvironment(environment) {
  const actual = Object.keys(environment)
    .filter((name) => name.startsWith("VIDEOFORGE_V2_13_"))
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify([...ENVIRONMENT_NAMES].sort()))
    fail("ENVIRONMENT_CLOSED_WORLD");
  for (const name of ENVIRONMENT_NAMES) {
    const value = environment[name];
    if (typeof value !== "string" || value === "" || !value.startsWith("/") || value.includes("\0"))
      fail("ENVIRONMENT_PATH", name);
  }
}

function planProtectedLaunch({
  attemptRoot,
  authorityId,
  proposalFile,
  approvalFile,
  authorityFile,
  materializationSeedFile,
  staticReleaseDescriptorFile,
  sourceFiles,
  wranglerOAuthConfigFile,
  baseEnvironment = process.env,
}) {
  const root = absoluteInputPath(attemptRoot, "ATTEMPT_ROOT_PATH");
  if (!AUTHORITY_ID.test(authorityId ?? "") || basename(root) !== authorityId)
    fail("ATTEMPT_ROOT_AUTHORITY");
  rejectArchivePath(root, "ATTEMPT_ROOT_ARCHIVE");
  exactDirectory(dirname(root), "ATTEMPT_PARENT");
  requireAbsent(root, "ATTEMPT_ROOT_NOT_FRESH");
  const sourceDirectory = join(root, "source");
  const postgresDirectory = join(root, "postgres-inputs");
  const secretDirectory = join(root, "secret-inputs");
  const artifactsDirectory = join(root, "artifacts");
  const staged = Object.freeze({
    proposal: stagePathFor(root, "source", STAGED_SOURCE_NAMES.proposal),
    approval: stagePathFor(root, "source", STAGED_SOURCE_NAMES.approval),
    authority: stagePathFor(root, "source", STAGED_SOURCE_NAMES.authority),
    materializationSeed: stagePathFor(root, "source", STAGED_SOURCE_NAMES.materializationSeed),
    staticReleaseDescriptor: stagePathFor(
      root,
      "source",
      STAGED_SOURCE_NAMES.staticReleaseDescriptor,
    ),
    wranglerOAuthConfig: stagePathFor(root, "source", STAGED_SOURCE_NAMES.wranglerOAuthConfig),
    credentialBootstrapReceipt: stagePathFor(
      root,
      "source",
      STAGED_SOURCE_NAMES.credentialBootstrapReceipt,
    ),
    googleClientId: stagePathFor(root, "source", STAGED_SOURCE_NAMES.googleClientId),
    googleClientSecret: stagePathFor(root, "source", STAGED_SOURCE_NAMES.googleClientSecret),
    r2AccessKeyId: stagePathFor(root, "source", STAGED_SOURCE_NAMES.r2AccessKeyId),
    r2SecretAccessKey: stagePathFor(root, "source", STAGED_SOURCE_NAMES.r2SecretAccessKey),
    runpodApiKey: stagePathFor(root, "source", STAGED_SOURCE_NAMES.runpodApiKey),
    ownerPgService: stagePathFor(root, "postgres-inputs", STAGED_POSTGRES_NAMES.ownerPgService),
    ownerPgpass: stagePathFor(root, "postgres-inputs", STAGED_POSTGRES_NAMES.ownerPgpass),
  });
  const inputPaths = [
    proposalFile,
    approvalFile,
    authorityFile,
    materializationSeedFile,
    staticReleaseDescriptorFile,
    wranglerOAuthConfigFile,
    ...Object.values(sourceFiles ?? {}),
  ].map((path) => absoluteInputPath(path, "INPUT_PATH"));
  if (new Set(inputPaths).size !== inputPaths.length) fail("INPUT_PATH_COLLISION");
  if (inputPaths.some((path) => pathIsWithin(root, path))) fail("INPUT_OUTPUT_COLLISION");

  const outputTargets = buildFutureOutputTargets({ attemptRoot: root, authorityId });
  for (const path of outputTargets) {
    rejectArchivePath(path, "OUTPUT_ARCHIVE_PATH");
    requireAbsent(path, "OUTPUT_PATH_PRESENT");
  }
  const environment = buildClosedEnvironment({
    postgresDirectory,
    secretDirectory,
    artifactsDirectory,
    staged,
    baseEnvironment,
  });
  return Object.freeze({
    attemptRoot: root,
    sourceDirectory,
    postgresDirectory,
    secretDirectory,
    artifactsDirectory,
    staged,
    outputTargets,
    environment,
    stateFile: join(root, "full-live-state.json"),
  });
}

function prepareProtectedLaunch({
  attemptRoot,
  authorityId,
  proposalFile,
  approvalFile,
  authorityFile,
  materializationSeedFile,
  staticReleaseDescriptorFile,
  sourceFiles,
  wranglerOAuthConfigFile,
  inputHashes = {},
  baseEnvironment = process.env,
}) {
  validateLaunchInputMetadata({
    proposalFile,
    approvalFile,
    authorityFile,
    materializationSeedFile,
    staticReleaseDescriptorFile,
    wranglerOAuthConfigFile,
    sourceFiles,
  });
  const plan = planProtectedLaunch({
    attemptRoot,
    authorityId,
    proposalFile,
    approvalFile,
    authorityFile,
    materializationSeedFile,
    staticReleaseDescriptorFile,
    sourceFiles,
    wranglerOAuthConfigFile,
    baseEnvironment,
  });
  for (const [path, code] of [
    [plan.attemptRoot, "ATTEMPT_ROOT"],
    [plan.sourceDirectory, "SOURCE_DIRECTORY"],
    [plan.postgresDirectory, "POSTGRES_DIRECTORY"],
    [plan.secretDirectory, "SECRET_DIRECTORY"],
    [plan.artifactsDirectory, "ARTIFACTS_DIRECTORY"],
  ])
    makeExactDirectory(path, code);

  const copied = {
    proposal: copyStableSource({
      source: proposalFile,
      destination: plan.staged.proposal,
      expectedSha256: inputHashes.proposal,
      code: "PROPOSAL",
    }),
    approval: copyStableSource({
      source: approvalFile,
      destination: plan.staged.approval,
      expectedSha256: inputHashes.approval,
      code: "APPROVAL",
    }),
    authority: copyStableSource({
      source: authorityFile,
      destination: plan.staged.authority,
      expectedSha256: inputHashes.authority,
      code: "AUTHORITY",
    }),
    materializationSeed: copyStableSource({
      source: materializationSeedFile,
      destination: plan.staged.materializationSeed,
      expectedSha256: inputHashes.materializationSeed,
      code: "MATERIALIZATION_SEED",
    }),
    staticReleaseDescriptor: copyStableSource({
      source: staticReleaseDescriptorFile,
      destination: plan.staged.staticReleaseDescriptor,
      expectedSha256: inputHashes.staticReleaseDescriptor,
      code: "STATIC_RELEASE_DESCRIPTOR",
    }),
    credentialBootstrapReceipt: copyStableSource({
      source: sourceFiles.credentialBootstrapReceipt,
      destination: plan.staged.credentialBootstrapReceipt,
      expectedSha256: SOURCE_HASHES.credentialBootstrapReceipt,
      code: "CREDENTIAL_BOOTSTRAP_RECEIPT",
    }),
    googleClientId: copyStableSource({
      source: sourceFiles.googleClientId,
      destination: plan.staged.googleClientId,
      expectedSha256: SOURCE_HASHES.googleClientId,
      code: "GOOGLE_CLIENT_ID",
    }),
    googleClientSecret: copyStableSource({
      source: sourceFiles.googleClientSecret,
      destination: plan.staged.googleClientSecret,
      expectedSha256: SOURCE_HASHES.googleClientSecret,
      code: "GOOGLE_CLIENT_SECRET",
    }),
    r2AccessKeyId: copyStableSource({
      source: sourceFiles.r2AccessKeyId,
      destination: plan.staged.r2AccessKeyId,
      expectedSha256: SOURCE_HASHES.r2AccessKeyId,
      code: "R2_ACCESS_KEY_ID",
    }),
    r2SecretAccessKey: copyStableSource({
      source: sourceFiles.r2SecretAccessKey,
      destination: plan.staged.r2SecretAccessKey,
      expectedSha256: SOURCE_HASHES.r2SecretAccessKey,
      code: "R2_SECRET_ACCESS_KEY",
    }),
    runpodApiKey: copyStableSource({
      source: sourceFiles.runpodApiKey,
      destination: plan.staged.runpodApiKey,
      expectedSha256: SOURCE_HASHES.runpodApiKey,
      code: "RUNPOD_API_KEY",
    }),
    ownerPgService: copyStableSource({
      source: sourceFiles.ownerPgService,
      destination: plan.staged.ownerPgService,
      expectedSha256: SOURCE_HASHES.ownerPgService,
      code: "OWNER_PG_SERVICE",
    }),
    ownerPgpass: copyStableSource({
      source: sourceFiles.ownerPgpass,
      destination: plan.staged.ownerPgpass,
      expectedSha256: SOURCE_HASHES.ownerPgpass,
      code: "OWNER_PGPASS",
    }),
  };
  const wrangler = stableProtectedBytes(
    wranglerOAuthConfigFile,
    undefined,
    "WRANGLER_OAUTH_CONFIG",
  );
  if (sha256(Buffer.from(wranglerOAuthConfigFile)) !== WRANGLER_OAUTH_PATH_SHA256)
    fail("WRANGLER_OAUTH_CONFIG_PATH_HASH");
  copied.wranglerOAuthConfig = copyStableSource({
    source: wranglerOAuthConfigFile,
    destination: plan.staged.wranglerOAuthConfig,
    expectedSha256: wrangler.sha256,
    code: "WRANGLER_OAUTH_CONFIG",
  });

  exactInventory(plan.sourceDirectory, Object.values(STAGED_SOURCE_NAMES), "SOURCE_INVENTORY");
  exactInventory(
    plan.postgresDirectory,
    Object.values(STAGED_POSTGRES_NAMES),
    "POSTGRES_INVENTORY",
  );
  exactInventory(plan.secretDirectory, [], "SECRET_INVENTORY");
  exactInventory(plan.artifactsDirectory, [], "ARTIFACTS_INVENTORY");
  return Object.freeze({
    ...plan,
    environment: buildClosedEnvironment({
      postgresDirectory: plan.postgresDirectory,
      secretDirectory: plan.secretDirectory,
      artifactsDirectory: plan.artifactsDirectory,
      staged: plan.staged,
      baseEnvironment,
    }),
    stateFile: plan.stateFile,
  });
}

function validateSourceContents({ sourceFiles, wranglerOAuthConfigFile }) {
  const hashes = Object.fromEntries(
    SOURCE_INPUT_NAMES.map((name) => {
      const observed = stableProtectedBytes(
        sourceFiles[name],
        SOURCE_HASHES[name],
        `SOURCE_${name.toUpperCase()}`,
      );
      return [name, observed.sha256];
    }),
  );
  const wrangler = stableProtectedBytes(
    wranglerOAuthConfigFile,
    undefined,
    "WRANGLER_OAUTH_CONFIG",
  );
  if (sha256(Buffer.from(wranglerOAuthConfigFile)) !== WRANGLER_OAUTH_PATH_SHA256)
    fail("WRANGLER_OAUTH_CONFIG_PATH_HASH");
  return Object.freeze({ ...hashes, wranglerOAuthConfig: wrangler.sha256 });
}

function runChild(spawn, args, environment, capture = false) {
  let result;
  try {
    result = spawn(process.execPath, args, {
      cwd: ROOT,
      env: environment,
      encoding: capture ? "utf8" : undefined,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    fail("CHILD_FAILED");
  }
  if (result.error !== undefined || result.status !== 0) fail("CHILD_FAILED");
  return result;
}

function parseArgs(argv) {
  const values = new Map();
  let execute = false;
  let preflightOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--execute" || token === "--preflight-only") {
      if (token === "--execute") execute = true;
      else preflightOnly = true;
      continue;
    }
    if (!token.startsWith("--") || index + 1 >= argv.length) fail("ARGUMENTS");
    const name = token.slice(2);
    if (values.has(name)) fail("ARGUMENT_DUPLICATE", name);
    values.set(name, argv[index + 1]);
    index += 1;
  }
  if (execute === preflightOnly) fail("ONE_MODE_REQUIRED");
  const allowed = new Set([
    "attempt-root",
    "proposal-file",
    "approval-file",
    "authority-file",
    "authority-record-commit",
    "materialization-seed-file",
    "static-release-descriptor-file",
    "credential-bootstrap-receipt-source-file",
    "google-client-id-source-file",
    "google-client-secret-source-file",
    "r2-access-key-id-source-file",
    "r2-secret-access-key-source-file",
    "runpod-api-key-source-file",
    "owner-pg-service-source-file",
    "owner-pgpass-source-file",
    "wrangler-oauth-config-file",
    "confirm",
  ]);
  if ([...values.keys()].some((name) => !allowed.has(name))) fail("ARGUMENT_UNKNOWN");
  for (const name of allowed) if (!values.has(name)) fail("ARGUMENT_REQUIRED", name);
  if (values.get("confirm") !== LAUNCH_CONFIRMATION) fail("CONFIRMATION");
  return { values, execute, preflightOnly };
}

function launch({ values, execute, preflightOnly, spawn = spawnSync }) {
  const paths = Object.fromEntries(
    [...values].map(([name, value]) => [
      name,
      ["authority-record-commit", "confirm"].includes(name)
        ? value
        : absoluteInputPath(value, `ARGUMENT_PATH_${name.toUpperCase()}`),
    ]),
  );
  const sourceFiles = {
    credentialBootstrapReceipt: paths["credential-bootstrap-receipt-source-file"],
    googleClientId: paths["google-client-id-source-file"],
    googleClientSecret: paths["google-client-secret-source-file"],
    r2AccessKeyId: paths["r2-access-key-id-source-file"],
    r2SecretAccessKey: paths["r2-secret-access-key-source-file"],
    runpodApiKey: paths["runpod-api-key-source-file"],
    ownerPgService: paths["owner-pg-service-source-file"],
    ownerPgpass: paths["owner-pgpass-source-file"],
  };
  validateLaunchInputMetadata({
    proposalFile: paths["proposal-file"],
    approvalFile: paths["approval-file"],
    authorityFile: paths["authority-file"],
    materializationSeedFile: paths["materialization-seed-file"],
    staticReleaseDescriptorFile: paths["static-release-descriptor-file"],
    wranglerOAuthConfigFile: paths["wrangler-oauth-config-file"],
    sourceFiles,
  });
  const authorityBinding = validateAuthorityInputs({
    proposalFile: paths["proposal-file"],
    approvalFile: paths["approval-file"],
    authorityFile: paths["authority-file"],
    authorityRecordCommit: values.get("authority-record-commit"),
    materializationSeedFile: paths["materialization-seed-file"],
    staticReleaseDescriptorFile: paths["static-release-descriptor-file"],
  });
  if (preflightOnly) {
    planProtectedLaunch({
      attemptRoot: paths["attempt-root"],
      authorityId: authorityBinding.authority.authority_id,
      proposalFile: paths["proposal-file"],
      approvalFile: paths["approval-file"],
      authorityFile: paths["authority-file"],
      materializationSeedFile: paths["materialization-seed-file"],
      staticReleaseDescriptorFile: paths["static-release-descriptor-file"],
      wranglerOAuthConfigFile: paths["wrangler-oauth-config-file"],
      sourceFiles,
    });
    process.stdout.write(
      `${JSON.stringify({ state: "PREFLIGHT_READY_NO_AUTHORITY_CONSUMED", external_calls: 0, mutations: 0, gpu_use: 0, spend_usd: 0, environment_variable_count: ENVIRONMENT_NAMES.length })}\n`,
    );
    return;
  }
  if (!execute) fail("EXECUTE_MODE");
  const sourceHashes = validateSourceContents({
    sourceFiles,
    wranglerOAuthConfigFile: paths["wrangler-oauth-config-file"],
  });
  const prepared = prepareProtectedLaunch({
    attemptRoot: paths["attempt-root"],
    authorityId: authorityBinding.authority.authority_id,
    proposalFile: paths["proposal-file"],
    approvalFile: paths["approval-file"],
    authorityFile: paths["authority-file"],
    materializationSeedFile: paths["materialization-seed-file"],
    staticReleaseDescriptorFile: paths["static-release-descriptor-file"],
    wranglerOAuthConfigFile: paths["wrangler-oauth-config-file"],
    sourceFiles,
    inputHashes: {
      ...authorityBinding.inputHashes,
      ...sourceHashes,
    },
  });
  const consume = runChild(
    spawn,
    [
      "deploy/v2-13/full-live-orchestration-authority.mjs",
      "--consume",
      "--proposal-file",
      prepared.staged.proposal,
      "--approval-file",
      prepared.staged.approval,
      "--authority-file",
      prepared.staged.authority,
      "--authority-record-commit",
      values.get("authority-record-commit"),
      "--state-file",
      prepared.stateFile,
      "--confirm",
      AUTHORITY_CONFIRMATION,
    ],
    prepared.environment,
    true,
  );
  let consumed;
  try {
    consumed = JSON.parse(consume.stdout);
  } catch {
    fail("CONSUMPTION_RESULT_JSON");
  }
  if (!HASH.test(consumed?.state_sha256 ?? "") || consumed?.state_file !== prepared.stateFile)
    fail("CONSUMPTION_RESULT");
  runChild(
    spawn,
    [
      "deploy/v2-13/full-live-executor.mjs",
      "--execute",
      "--state-file",
      prepared.stateFile,
      "--expected-state-sha256",
      consumed.state_sha256,
      "--confirm",
      EXECUTOR_CONFIRMATION,
    ],
    prepared.environment,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    launch(parseArgs(process.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = /^V2_13_FULL_LIVE_LAUNCH_[A-Z0-9_]+$/u.test(message)
      ? message
      : "V2_13_FULL_LIVE_LAUNCH_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

export {
  ENVIRONMENT_NAMES,
  LAUNCH_CONFIRMATION,
  SOURCE_HASHES,
  WRANGLER_OAUTH_PATH_SHA256,
  assertClosedEnvironment,
  buildClosedEnvironment,
  buildFutureOutputTargets,
  launch,
  planProtectedLaunch,
  parseArgs,
  prepareProtectedLaunch,
  validateLaunchInputMetadata,
  validateSourceContents,
  validateAuthorityInputs,
};

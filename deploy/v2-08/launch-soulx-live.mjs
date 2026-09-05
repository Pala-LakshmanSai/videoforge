#!/usr/bin/env node

/**
 * Standalone V2-08 launcher.
 *
 * This process is deliberately smaller than the V2-13 launcher.  It is a protected
 * process boundary for the SoulX qualification child, not an authority materializer:
 * the child owns RunPod keychain loading and the qualification contract owns admission,
 * dispatch, durable state, and cleanup.  No provider client is imported here.
 */

import { createHash, createPrivateKey, generateKeyPairSync, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn as nodeSpawn } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const QUALIFICATION_CLI_RELATIVE_PATH = "apps/web/src/server/providers/v208-soulx-live-cli.ts";
const QUALIFICATION_CLI_PATH = resolve(ROOT, QUALIFICATION_CLI_RELATIVE_PATH);
const TSX_LOADER_RELATIVE_PATH = "apps/web/node_modules/tsx/dist/loader.mjs";
const TSX_LOADER_PATH = resolve(ROOT, TSX_LOADER_RELATIVE_PATH);
const TSX_LOADER_SOURCE_SHA256 =
  "sha256:0b1c5b86192772fe9257710e739959cee5947c11ae1f93b61abfaa9b80c6def1";

export const LAUNCH_CONFIRMATION = "LAUNCH_EXACT_V2_08_SOULX_LIVE_ONCE";
export const CHILD_CONFIRMATION = "EXECUTE_EXACT_V2_08_SOULX_QUALIFICATION";
export const REQUEST_SCHEMA = "videoforge.v2-08-soulx-live-request/v1";
export const INPUT_MANIFEST_SCHEMA = "videoforge.v2-08-soulx-protected-input-manifest/v1";
export const PRODUCTION_SECRETS_SCHEMA = "videoforge.v2-08-soulx-qualification-secrets/v1";
export const JOURNAL_ENVIRONMENT_NAME = "V208_DURABLE_JOURNAL_DIRECTORY";
export const DEFAULT_R2_SECRETS_DIRECTORY = join(
  homedir(),
  ".videoforge",
  "v2-13",
  "bootstrap",
  "secrets",
);

const HASH = /^sha256:[0-9a-f]{64}$/u;
const ACCOUNT_ID = /^[0-9a-f]{32}$/u;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_BINARY_BYTES = 16 * 1024 * 1024;
const SAFE_INHERITED_ENVIRONMENT = Object.freeze([
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

/** Names and descriptor order are part of the child contract.  Do not add ambient bindings. */
export const CHILD_ENVIRONMENT_NAMES = Object.freeze([
  JOURNAL_ENVIRONMENT_NAME,
  "V208_REQUEST_FD",
  "V208_PRODUCTION_SECRETS_FD",
  "V208_R2_ACCOUNT_ID_FD",
  "V208_R2_ACCESS_KEY_ID_FD",
  "V208_R2_SECRET_ACCESS_KEY_FD",
  "V208_R2_BUCKET_NAME_FD",
  "V208_QUALIFICATION_AVATAR_SOURCE_FD",
  "V208_QUALIFICATION_AUDIO_2S_FD",
  "V208_QUALIFICATION_AUDIO_4S_FD",
  "V208_QUALIFICATION_AUDIO_6S_FD",
  "V208_QUALIFICATION_AUDIO_10S_FD",
]);

const FD_BINDINGS = Object.freeze([
  ["request", "V208_REQUEST_FD"],
  ["productionSecrets", "V208_PRODUCTION_SECRETS_FD"],
  ["r2AccountId", "V208_R2_ACCOUNT_ID_FD"],
  ["r2AccessKeyId", "V208_R2_ACCESS_KEY_ID_FD"],
  ["r2SecretAccessKey", "V208_R2_SECRET_ACCESS_KEY_FD"],
  ["r2BucketName", "V208_R2_BUCKET_NAME_FD"],
  ["avatarSource", "V208_QUALIFICATION_AVATAR_SOURCE_FD"],
  ["audio2s", "V208_QUALIFICATION_AUDIO_2S_FD"],
  ["audio4s", "V208_QUALIFICATION_AUDIO_4S_FD"],
  ["audio6s", "V208_QUALIFICATION_AUDIO_6S_FD"],
  ["audio10s", "V208_QUALIFICATION_AUDIO_10S_FD"],
]);

const SECRET_KEYS = Object.freeze([
  "acceptanceEvidenceSigningKeyBase64",
  "pairDispatchTokenKeyBase64",
  "pairDispatchTokenKeyId",
  "pairEnvelopeSigningKeyHex",
  "pairEnvelopeSigningKeyId",
  "pairProviderProofKeyHex",
  "pairProviderProofKeyId",
  "provenanceReceiptHmacKeyBase64",
  "provenanceReceiptKeyId",
  "schemaVersion",
  "stageAuthoritySigningKeyBase64",
]);

const fail = (code) => {
  throw new Error(`V2_08_SOULX_LAUNCH_${code}`);
};

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function exactAbsolutePath(value, code) {
  if (
    typeof value !== "string" ||
    value === "" ||
    !value.startsWith(sep) ||
    value.includes("\0") ||
    resolve(value) !== value
  )
    fail(code);
  return value;
}

function rejectArchivePath(path, code) {
  const parts = resolve(path).split(sep);
  if (parts.includes("archive") || parts.includes("archives") || parts.includes("history"))
    fail(code);
}

function assertOwner(metadata, code) {
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) fail(code);
}

function exactDirectory(path, code) {
  const absolute = exactAbsolutePath(path, code);
  try {
    const metadata = lstatSync(absolute);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o700 ||
      !realpathSync(absolute)
    )
      fail(code);
    assertOwner(metadata, code);
    return metadata;
  } catch (error) {
    if (error instanceof Error && error.message === `V2_08_SOULX_LAUNCH_${code}`) throw error;
    fail(code);
  }
}

function ensureDirectory(path, code) {
  const absolute = exactAbsolutePath(path, code);
  try {
    mkdirSync(absolute, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error && error.code === "EEXIST")) fail(code);
  }
  chmodSync(absolute, 0o700);
  return exactDirectory(absolute, code);
}

function exactFile(path, code, { minBytes = 1, maxBytes = MAX_TEXT_BYTES } = {}) {
  const absolute = exactAbsolutePath(path, code);
  try {
    const metadata = lstatSync(absolute);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o600 ||
      !realpathSync(absolute) ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < minBytes ||
      metadata.size > maxBytes
    )
      fail(code);
    assertOwner(metadata, code);
    return metadata;
  } catch (error) {
    if (error instanceof Error && error.message === `V2_08_SOULX_LAUNCH_${code}`) throw error;
    fail(code);
  }
}

function readDescriptor(descriptor, size, code) {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    let count;
    try {
      count = readSync(descriptor, bytes, offset, size - offset, offset);
    } catch {
      fail(code);
    }
    if (count === 0) fail(code);
    offset += count;
  }
  return bytes;
}

/** Open and hash a path without following a file symlink or accepting a replacement race. */
function openStableFile(path, expectedSha256, code, options = {}) {
  const beforePath = exactFile(path, code, options);
  let descriptor;
  let retainDescriptor = false;
  try {
    descriptor = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const descriptorBefore = fstatSync(descriptor);
    const before = lstatSync(path);
    if (
      descriptorBefore.dev !== before.dev ||
      descriptorBefore.ino !== before.ino ||
      before.dev !== beforePath.dev ||
      before.ino !== beforePath.ino ||
      descriptorBefore.size !== before.size
    )
      fail(`${code}_RACE`);
    const bytes = readDescriptor(descriptor, before.size, `${code}_READ`);
    const descriptorAfter = fstatSync(descriptor);
    const after = lstatSync(path);
    if (
      descriptorAfter.dev !== before.dev ||
      descriptorAfter.ino !== before.ino ||
      descriptorAfter.size !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      fail(`${code}_RACE`);
    const actualSha256 = sha256(bytes);
    if (expectedSha256 !== undefined && actualSha256 !== expectedSha256) fail(`${code}_HASH`);
    retainDescriptor = true;
    return Object.freeze({ descriptor, bytes, sha256: actualSha256, metadata: before });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_08_SOULX_LAUNCH_")) throw error;
    fail(code);
  } finally {
    if (descriptor !== undefined && !retainDescriptor) closeQuietly(descriptor);
  }
}

function closeQuietly(descriptor) {
  try {
    closeSync(descriptor);
  } catch {
    // The child may have closed an inherited duplicate; the parent descriptor is still safe to ignore.
  }
}

function pathWithin(parent, child) {
  const suffix = resolve(child).slice(resolve(parent).length);
  return suffix === "" || suffix.startsWith(sep);
}

function validatePinnedChildSources() {
  const loader = exactAbsolutePath(TSX_LOADER_PATH, "TSX_LOADER_PATH");
  const cli = exactAbsolutePath(QUALIFICATION_CLI_PATH, "QUALIFICATION_CLI_PATH");
  let loaderMetadata;
  let cliMetadata;
  try {
    loaderMetadata = lstatSync(loader);
    cliMetadata = lstatSync(cli);
    if (
      !loaderMetadata.isFile() ||
      loaderMetadata.isSymbolicLink() ||
      (loaderMetadata.mode & 0o111) === 0 ||
      !cliMetadata.isFile() ||
      cliMetadata.isSymbolicLink() ||
      !pathWithin(ROOT, realpathSync(loader)) ||
      !pathWithin(ROOT, realpathSync(cli))
    )
      fail("CHILD_SOURCE_INVALID");
    if (sha256(readFileSync(loader)) !== TSX_LOADER_SOURCE_SHA256) fail("TSX_LOADER_SOURCE_DRIFT");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_08_SOULX_LAUNCH_")) throw error;
    fail("CHILD_SOURCE_INVALID");
  }
  return Object.freeze({
    cliSha256: sha256(readFileSync(cli)),
    loaderSha256: TSX_LOADER_SOURCE_SHA256,
  });
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function exactKeys(value, expected) {
  return (
    object(value) !== null &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  );
}

function parseJsonBytes(bytes, code) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(code);
  }
}

function parseRequest(record) {
  const value = object(record);
  if (
    value === null ||
    !exactKeys(value, ["schema_version", "command", "request_id", "input", "r2"]) ||
    value.schema_version !== REQUEST_SCHEMA ||
    value.command !== "soulx-live-qualification" ||
    typeof value.request_id !== "string" ||
    !COMMAND_ID.test(value.request_id) ||
    object(value.input) === null
  )
    fail("REQUEST_INVALID");
  return value;
}

function parseInputEntry(value, expectedContentType, code) {
  if (!exactKeys(value, ["content_type", "path", "sha256", "size_bytes"])) fail(code);
  if (
    value.content_type !== expectedContentType ||
    typeof value.path !== "string" ||
    !value.path.startsWith(sep) ||
    value.path.includes("\0") ||
    resolve(value.path) !== value.path ||
    !HASH.test(value.sha256) ||
    !Number.isSafeInteger(value.size_bytes) ||
    value.size_bytes < 1 ||
    value.size_bytes > MAX_BINARY_BYTES
  )
    fail(code);
  rejectArchivePath(value.path, `${code}_ARCHIVE_PATH`);
  return value;
}

function parseInputManifest(record) {
  const value = object(record);
  if (!exactKeys(value, ["schema_version", "avatar_source", "audio_sources"]))
    fail("INPUT_MANIFEST_INVALID");
  if (value.schema_version !== INPUT_MANIFEST_SCHEMA) fail("INPUT_MANIFEST_SCHEMA");
  const avatarSource = parseInputEntry(value.avatar_source, "image/png", "AVATAR_SOURCE_INVALID");
  const audioSources = value.audio_sources;
  if (!exactKeys(audioSources, ["2", "4", "6", "10"])) fail("AUDIO_SOURCES_INVALID");
  const entries = Object.freeze({
    avatarSource,
    audio2s: parseInputEntry(audioSources["2"], "audio/wav", "AUDIO_2S_INVALID"),
    audio4s: parseInputEntry(audioSources["4"], "audio/wav", "AUDIO_4S_INVALID"),
    audio6s: parseInputEntry(audioSources["6"], "audio/wav", "AUDIO_6S_INVALID"),
    audio10s: parseInputEntry(audioSources["10"], "audio/wav", "AUDIO_10S_INVALID"),
  });
  return entries;
}

function validateRequestInputBinding(request, manifest, r2) {
  const input = object(request.input);
  const dualLaneInput = object(input?.dualLaneInput);
  const descriptors = object(dualLaneInput?.qualificationProtectedInputDescriptors);
  const qualificationR2 = object(dualLaneInput?.qualificationR2);
  if (
    dualLaneInput === null ||
    descriptors === null ||
    qualificationR2 === null ||
    !exactKeys(qualificationR2, ["accountId", "bucketName"]) ||
    qualificationR2.accountId !== r2.account_id ||
    qualificationR2.bucketName !== r2.bucket_name
  )
    fail("REQUEST_INPUT_BINDING");
  const bindings = [
    ["avatarSource", "avatarSource"],
    ["soulx2s", "audio2s"],
    ["soulx4s", "audio4s"],
    ["soulx6s", "audio6s"],
    ["soulx10s", "audio10s"],
  ];
  for (const [requestName, manifestName] of bindings) {
    const descriptor = descriptors[requestName];
    const entry = manifest[manifestName];
    if (
      !exactKeys(descriptor, ["contentType", "path", "sha256", "sizeBytes"]) ||
      typeof descriptor.path !== "string" ||
      descriptor.path.length < 3 ||
      descriptor.path.length > 400 ||
      !descriptor.path.startsWith(".videoforge/private/") ||
      descriptor.path.split("/").includes("..") ||
      !HASH.test(descriptor.sha256) ||
      descriptor.sha256 !== entry.sha256 ||
      descriptor.sizeBytes !== entry.size_bytes ||
      descriptor.contentType !== entry.content_type
    )
      fail("REQUEST_INPUT_BINDING");
  }
}

function readJsonFile(path, code, maxBytes = MAX_TEXT_BYTES) {
  const opened = openStableFile(path, undefined, code, { minBytes: 2, maxBytes });
  try {
    return Object.freeze({ value: parseJsonBytes(opened.bytes, `${code}_JSON`), ...opened });
  } finally {
    closeQuietly(opened.descriptor);
  }
}

function parseR2Binding(request, values) {
  const candidates = [request.r2, request.qualification?.r2, request.input?.r2].filter(
    (value) => value !== undefined,
  );
  const hasCliBinding = [
    "r2-account-id",
    "r2-bucket-name",
    "r2-account-id-file",
    "r2-bucket-name-file",
  ].some((name) => values.has(name));
  let binding = candidates.length === 1 ? object(candidates[0]) : null;
  if (binding !== null && hasCliBinding) fail("R2_BINDING_DUPLICATE");
  if (binding !== null && !exactKeys(binding, ["account_id", "bucket_name"])) fail("R2_BINDING");
  if (binding === null) {
    if (values.has("r2-account-id") && values.has("r2-bucket-name")) {
      binding = {
        account_id: values.get("r2-account-id"),
        bucket_name: values.get("r2-bucket-name"),
      };
    } else if (values.has("r2-account-id-file") && values.has("r2-bucket-name-file")) {
      const account = openStableFile(
        values.get("r2-account-id-file"),
        undefined,
        "R2_ACCOUNT_ID_FILE",
        { minBytes: 32, maxBytes: 128 },
      );
      const bucket = openStableFile(
        values.get("r2-bucket-name-file"),
        undefined,
        "R2_BUCKET_NAME_FILE",
        { minBytes: 3, maxBytes: 128 },
      );
      try {
        binding = {
          account_id: account.bytes.toString("utf8"),
          bucket_name: bucket.bytes.toString("utf8"),
        };
      } finally {
        closeQuietly(account.descriptor);
        closeQuietly(bucket.descriptor);
      }
    } else fail("R2_BINDING_REQUIRED");
  }
  if (
    typeof binding.account_id !== "string" ||
    typeof binding.bucket_name !== "string" ||
    binding.account_id.trim() !== binding.account_id ||
    binding.bucket_name.trim() !== binding.bucket_name ||
    !ACCOUNT_ID.test(binding.account_id) ||
    !BUCKET_NAME.test(binding.bucket_name)
  )
    fail("R2_BINDING_INVALID");
  return Object.freeze(binding);
}

function parseProductionSecrets(value) {
  const record = object(value);
  if (record === null) fail("PRODUCTION_SECRETS_INVALID");
  const keys = Object.keys(record).sort();
  if (
    ![PRODUCTION_SECRETS_SCHEMA, "videoforge.v213-full-live-pre-endpoint-secrets/v1"].includes(
      record.schemaVersion,
    ) ||
    JSON.stringify(keys) !== JSON.stringify([...SECRET_KEYS].sort())
  )
    fail("PRODUCTION_SECRETS_INVALID");
  if (
    typeof record.stageAuthoritySigningKeyBase64 !== "string" ||
    typeof record.provenanceReceiptHmacKeyBase64 !== "string" ||
    typeof record.acceptanceEvidenceSigningKeyBase64 !== "string" ||
    typeof record.pairDispatchTokenKeyBase64 !== "string" ||
    typeof record.pairEnvelopeSigningKeyHex !== "string" ||
    typeof record.pairProviderProofKeyHex !== "string" ||
    typeof record.provenanceReceiptKeyId !== "string" ||
    typeof record.pairDispatchTokenKeyId !== "string" ||
    typeof record.pairEnvelopeSigningKeyId !== "string" ||
    typeof record.pairProviderProofKeyId !== "string" ||
    !COMMAND_ID.test(record.provenanceReceiptKeyId) ||
    !COMMAND_ID.test(record.pairDispatchTokenKeyId) ||
    !COMMAND_ID.test(record.pairEnvelopeSigningKeyId) ||
    !COMMAND_ID.test(record.pairProviderProofKeyId) ||
    new Set([
      record.provenanceReceiptKeyId,
      record.pairDispatchTokenKeyId,
      record.pairEnvelopeSigningKeyId,
      record.pairProviderProofKeyId,
    ]).size !== 4 ||
    !/^(?:[0-9a-f]{2}){32,}$/u.test(record.pairEnvelopeSigningKeyHex) ||
    !/^(?:[0-9a-f]{2}){32,}$/u.test(record.pairProviderProofKeyHex)
  )
    fail("PRODUCTION_SECRETS_INVALID");
  const decodedKeyBytes = [];
  for (const name of [
    "stageAuthoritySigningKeyBase64",
    "provenanceReceiptHmacKeyBase64",
    "acceptanceEvidenceSigningKeyBase64",
    "pairDispatchTokenKeyBase64",
  ]) {
    const raw = record[name];
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(raw))
      fail("PRODUCTION_SECRETS_INVALID");
    const bytes = Buffer.from(raw, "base64");
    if (bytes.length < 32 || bytes.toString("base64") !== raw) fail("PRODUCTION_SECRETS_INVALID");
    decodedKeyBytes.push(bytes);
  }
  const allKeyBytes = [
    ...decodedKeyBytes,
    Buffer.from(record.pairEnvelopeSigningKeyHex, "hex"),
    Buffer.from(record.pairProviderProofKeyHex, "hex"),
  ];
  if (
    new Set(allKeyBytes.map((bytes) => createHash("sha256").update(bytes).digest("hex"))).size !==
    allKeyBytes.length
  )
    fail("PRODUCTION_SECRET_REUSE");
  try {
    createPrivateKey({
      key: Buffer.from(record.stageAuthoritySigningKeyBase64, "base64"),
      format: "der",
      type: "pkcs8",
    });
  } catch {
    fail("PRODUCTION_SECRETS_INVALID");
  }
  return Object.freeze(record);
}

function ephemeralProductionSecrets() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const value = {
    schemaVersion: PRODUCTION_SECRETS_SCHEMA,
    stageAuthoritySigningKeyBase64: privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
    provenanceReceiptHmacKeyBase64: randomBytes(32).toString("base64"),
    provenanceReceiptKeyId: "v208-qualification-provenance",
    acceptanceEvidenceSigningKeyBase64: randomBytes(32).toString("base64"),
    pairDispatchTokenKeyBase64: randomBytes(32).toString("base64"),
    pairDispatchTokenKeyId: "v208-qualification-dispatch",
    pairEnvelopeSigningKeyHex: randomBytes(32).toString("hex"),
    pairEnvelopeSigningKeyId: "v208-qualification-envelope",
    pairProviderProofKeyHex: randomBytes(32).toString("hex"),
    pairProviderProofKeyId: "v208-qualification-provider-proof",
  };
  return parseProductionSecrets(value);
}

function writePrivateJson(path, value, code) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  let descriptor;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    if (writeSync(descriptor, bytes) !== bytes.length) fail(code);
    fsyncSync(descriptor);
    chmodSync(path, 0o600);
  } catch (error) {
    if (error instanceof Error && error.message === `V2_08_SOULX_LAUNCH_${code}`) throw error;
    fail(code);
  } finally {
    if (descriptor !== undefined) closeQuietly(descriptor);
  }
  exactFile(path, code, { minBytes: 2, maxBytes: MAX_TEXT_BYTES });
  return path;
}

function privateBindingFile(journalDirectory, name, value) {
  const path = resolve(journalDirectory, name);
  if (resolve(dirname(path)) !== resolve(journalDirectory)) fail("JOURNAL_PATH");
  let existing = false;
  try {
    lstatSync(path);
    existing = true;
  } catch (error) {
    if (error?.code !== "ENOENT") fail("JOURNAL_BINDING");
  }
  const bytes = Buffer.from(value, "utf8");
  if (existing) {
    const opened = openStableFile(path, undefined, "JOURNAL_BINDING", {
      minBytes: bytes.length,
      maxBytes: bytes.length,
    });
    try {
      if (!opened.bytes.equals(bytes)) fail("JOURNAL_BINDING_MISMATCH");
    } finally {
      closeQuietly(opened.descriptor);
    }
    return path;
  }
  let descriptor;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    if (writeSync(descriptor, bytes) !== bytes.length) fail("JOURNAL_BINDING_WRITE");
    fsyncSync(descriptor);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_08_SOULX_LAUNCH_")) throw error;
    fail("JOURNAL_BINDING_WRITE");
  } finally {
    if (descriptor !== undefined) closeQuietly(descriptor);
  }
  return path;
}

function resolveJournalDirectory(value) {
  if (value !== undefined) {
    const path = exactAbsolutePath(value, "JOURNAL_PATH");
    rejectArchivePath(path, "JOURNAL_ARCHIVE_PATH");
    try {
      lstatSync(path);
      exactDirectory(path, "JOURNAL_DIRECTORY");
      return Object.freeze({ path, fresh: false });
    } catch (error) {
      if (!(error instanceof Error && error.code === "ENOENT")) {
        if (error instanceof Error && error.message.startsWith("V2_08_SOULX_LAUNCH_")) throw error;
        fail("JOURNAL_DIRECTORY");
      }
      const parent = dirname(path);
      ensureDirectory(parent, "JOURNAL_PARENT");
      mkdirSync(path, { mode: 0o700 });
      exactDirectory(path, "JOURNAL_DIRECTORY");
      return Object.freeze({ path, fresh: true });
    }
  }
  const parent = join(homedir(), ".videoforge", "v2-08");
  ensureDirectory(join(homedir(), ".videoforge"), "VIDEOFORGE_DIRECTORY");
  ensureDirectory(parent, "JOURNAL_PARENT");
  const path = mkdtempSync(join(parent, "soulx-live-"));
  chmodSync(path, 0o700);
  exactDirectory(path, "JOURNAL_DIRECTORY");
  return Object.freeze({ path, fresh: true });
}

function sourceDescriptors(manifest, codePrefix = "SOURCE") {
  const result = {};
  try {
    for (const [name, entry] of Object.entries(manifest)) {
      const options = {
        minBytes: name === "avatarSource" ? 1 : 44,
        maxBytes: MAX_BINARY_BYTES,
      };
      result[name] = openStableFile(
        entry.path,
        entry.sha256,
        `${codePrefix}_${name.toUpperCase()}`,
        options,
      );
      if (result[name].bytes.length !== entry.size_bytes) {
        fail(`${codePrefix}_${name.toUpperCase()}_SIZE`);
      }
    }
  } catch (error) {
    for (const value of Object.values(result)) closeQuietly(value.descriptor);
    throw error;
  }
  return result;
}

function buildChildEnvironment(baseEnvironment, journalDirectory, descriptors) {
  const environment = Object.fromEntries(
    SAFE_INHERITED_ENVIRONMENT.filter((name) => typeof baseEnvironment[name] === "string").map(
      (name) => [name, baseEnvironment[name]],
    ),
  );
  environment[JOURNAL_ENVIRONMENT_NAME] = journalDirectory;
  for (const [index, [name, envName]] of FD_BINDINGS.entries()) {
    if (!descriptors[name] || !Number.isSafeInteger(descriptors[name].descriptor))
      fail("FD_BINDINGS");
    // Node maps extra stdio entries to child descriptors 3..N.  The parent descriptor number
    // is intentionally not exposed because it is unrelated to the child's inherited number.
    environment[envName] = String(index + 3);
  }
  const actual = Object.keys(environment)
    .filter((name) => name.startsWith("V208_"))
    .sort();
  const expected = [...CHILD_ENVIRONMENT_NAMES].filter((name) => name.startsWith("V208_")).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("ENVIRONMENT_ALLOWLIST");
  return Object.freeze(environment);
}

function validateOptionPath(values, name) {
  if (!values.has(name)) return undefined;
  const path = exactAbsolutePath(
    values.get(name),
    `ARGUMENT_${name.toUpperCase().replaceAll("-", "_")}`,
  );
  rejectArchivePath(path, "ARGUMENT_ARCHIVE_PATH");
  return path;
}

export function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--") || index + 1 >= argv.length) fail("ARGUMENTS");
    const name = token.slice(2);
    if (values.has(name)) fail("ARGUMENT_DUPLICATE");
    values.set(name, argv[index + 1]);
    index += 1;
  }
  const allowed = new Set([
    "request-file",
    "input-manifest-file",
    "production-secrets-file",
    "journal-dir",
    "r2-account-id",
    "r2-bucket-name",
    "r2-account-id-file",
    "r2-bucket-name-file",
    "confirm",
  ]);
  for (const name of values.keys()) if (!allowed.has(name)) fail("ARGUMENT_UNKNOWN");
  for (const name of ["request-file", "input-manifest-file", "confirm"])
    if (!values.has(name)) fail("ARGUMENT_REQUIRED");
  if (values.get("confirm") !== LAUNCH_CONFIRMATION) fail("CONFIRMATION");
  if (
    values.has("r2-account-id") !== values.has("r2-bucket-name") ||
    values.has("r2-account-id-file") !== values.has("r2-bucket-name-file") ||
    (values.has("r2-account-id") && values.has("r2-account-id-file"))
  )
    fail("R2_BINDING_MODE");
  return Object.freeze({ values });
}

export function prepareLaunch({
  values,
  baseEnvironment = process.env,
  r2SecretsDirectory = DEFAULT_R2_SECRETS_DIRECTORY,
} = {}) {
  if (!(values instanceof Map)) fail("ARGUMENTS");
  const childSources = validatePinnedChildSources();
  const requestPath = validateOptionPath(values, "request-file");
  const manifestPath = validateOptionPath(values, "input-manifest-file");
  const productionSecretsPath = validateOptionPath(values, "production-secrets-file");
  const journal = resolveJournalDirectory(validateOptionPath(values, "journal-dir"));
  if (requestPath === undefined || manifestPath === undefined) fail("INPUT_REQUIRED");

  const requestFile = readJsonFile(requestPath, "REQUEST_FILE");
  const request = parseRequest(requestFile.value);
  const manifestFile = readJsonFile(manifestPath, "INPUT_MANIFEST_FILE", 1024 * 1024);
  const manifest = parseInputManifest(manifestFile.value);
  const r2 = parseR2Binding(request, values);
  validateRequestInputBinding(request, manifest, r2);

  const r2AccountFile = values.has("r2-account-id-file")
    ? validateOptionPath(values, "r2-account-id-file")
    : privateBindingFile(journal.path, "r2-account-id", r2.account_id);
  const r2BucketFile = values.has("r2-bucket-name-file")
    ? validateOptionPath(values, "r2-bucket-name-file")
    : privateBindingFile(journal.path, "r2-bucket-name", r2.bucket_name);

  let secretPath = productionSecretsPath;
  if (secretPath === undefined) {
    const generatedPath = resolve(journal.path, "production-secrets.json");
    try {
      lstatSync(generatedPath);
      if (journal.fresh) fail("GENERATED_SECRETS_PRESENT");
      secretPath = generatedPath;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("V2_08_SOULX_LAUNCH_")) throw error;
      if (error?.code !== "ENOENT") fail("GENERATED_SECRETS_PATH");
      if (!journal.fresh) fail("GENERATED_SECRETS_REQUIRED_FOR_RESUME");
      writePrivateJson(generatedPath, ephemeralProductionSecrets(), "GENERATED_SECRETS_WRITE");
      secretPath = generatedPath;
    }
  }
  const secretsFile = readJsonFile(secretPath, "PRODUCTION_SECRETS_FILE");
  parseProductionSecrets(secretsFile.value);

  exactDirectory(r2SecretsDirectory, "R2_SECRETS_DIRECTORY");
  const opened = {};
  try {
    Object.assign(opened, {
      request: openStableFile(requestPath, requestFile.sha256, "REQUEST_INPUT", { minBytes: 2 }),
      productionSecrets: openStableFile(
        secretPath,
        secretsFile.sha256,
        "PRODUCTION_SECRETS_INPUT",
        { minBytes: 2 },
      ),
      r2AccountId: openStableFile(r2AccountFile, undefined, "R2_ACCOUNT_ID_INPUT", {
        minBytes: 32,
        maxBytes: 128,
      }),
      r2AccessKeyId: openStableFile(
        join(r2SecretsDirectory, "R2_ACCESS_KEY_ID"),
        undefined,
        "R2_ACCESS_KEY_ID_INPUT",
        { minBytes: 16, maxBytes: 512 },
      ),
      r2SecretAccessKey: openStableFile(
        join(r2SecretsDirectory, "R2_SECRET_ACCESS_KEY"),
        undefined,
        "R2_SECRET_ACCESS_KEY_INPUT",
        { minBytes: 32, maxBytes: 512 },
      ),
      r2BucketName: openStableFile(r2BucketFile, undefined, "R2_BUCKET_NAME_INPUT", {
        minBytes: 3,
        maxBytes: 128,
      }),
    });
    Object.assign(opened, sourceDescriptors(manifest));
    const childEnvironment = buildChildEnvironment(baseEnvironment, journal.path, opened);
    return Object.freeze({
      request,
      manifest,
      r2,
      journalDirectory: journal.path,
      freshJournal: journal.fresh,
      sourceManifestSha256: manifestFile.sha256,
      requestSha256: requestFile.sha256,
      productionSecretsSha256: secretsFile.sha256,
      childCliSha256: childSources.cliSha256,
      childLoaderSha256: childSources.loaderSha256,
      childEnvironment,
      childArgs: ["--import", TSX_LOADER_PATH, QUALIFICATION_CLI_PATH, CHILD_CONFIRMATION],
      opened,
    });
  } catch (error) {
    for (const value of Object.values(opened)) closeQuietly(value.descriptor);
    throw error;
  }
}

function closePlan(plan) {
  for (const value of Object.values(plan.opened ?? {})) closeQuietly(value.descriptor);
}

function validatePreparedPlan(plan) {
  if (
    !plan ||
    !Array.isArray(plan.childArgs) ||
    object(plan.opened) === null ||
    object(plan.childEnvironment) === null
  )
    fail("PLAN_INVALID");
  if (
    typeof plan.journalDirectory !== "string" ||
    plan.childEnvironment?.[JOURNAL_ENVIRONMENT_NAME] !== plan.journalDirectory
  )
    fail("PLAN_JOURNAL");
  const expectedChildArgs = [
    "--import",
    TSX_LOADER_PATH,
    QUALIFICATION_CLI_PATH,
    CHILD_CONFIRMATION,
  ];
  if (JSON.stringify(plan.childArgs) !== JSON.stringify(expectedChildArgs))
    fail("PLAN_CHILD_COMMAND");
  const expectedNames = FD_BINDINGS.map(([name]) => name);
  if (JSON.stringify(Object.keys(plan.opened)) !== JSON.stringify(expectedNames)) fail("PLAN_FDS");
  for (const [index, [name, envName]] of FD_BINDINGS.entries()) {
    if (
      !Number.isSafeInteger(plan.opened[name]?.descriptor) ||
      plan.childEnvironment?.[envName] !== String(index + 3)
    )
      fail("PLAN_FDS");
  }
}

/**
 * Run exactly one child.  There is intentionally no retry or redispatch path here; a caller
 * resumes using the same journal directory and the child’s durable cleanup state.
 */
export function runPreparedLaunch(plan, { spawn = nodeSpawn, signalSource = process } = {}) {
  validatePreparedPlan(plan);
  let child;
  let settled = false;
  let forwarded = false;
  const signalHandlers = new Map();
  return new Promise((resolve, reject) => {
    try {
      const stdio = [
        "ignore",
        "inherit",
        "inherit",
        ...Object.values(plan.opened).map((value) => value.descriptor),
      ];
      child = spawn(process.execPath, plan.childArgs, {
        cwd: ROOT,
        env: plan.childEnvironment,
        shell: false,
        stdio,
      });
    } catch {
      closePlan(plan);
      reject(new Error("V2_08_SOULX_LAUNCH_CHILD_SPAWN"));
      return;
    }
    if (!child || !Number.isSafeInteger(child.pid) || child.pid < 1) {
      closePlan(plan);
      reject(new Error("V2_08_SOULX_LAUNCH_CHILD_INVALID"));
      return;
    }
    const forward = (signal) => {
      if (forwarded || settled) return;
      forwarded = true;
      try {
        child.kill(signal);
      } catch {
        // The child exit handler still closes all parent descriptors and resolves the run.
      }
    };
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => forward(signal);
      signalHandlers.set(signal, handler);
      signalSource.once(signal, handler);
    }
    child.once("error", () => {
      if (settled) return;
      settled = true;
      for (const [signal, handler] of signalHandlers) signalSource.off(signal, handler);
      closePlan(plan);
      reject(new Error("V2_08_SOULX_LAUNCH_CHILD_ERROR"));
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      for (const [name, handler] of signalHandlers) signalSource.off(name, handler);
      closePlan(plan);
      resolve(Object.freeze({ code, signal, journalDirectory: plan.journalDirectory }));
    });
  });
}

export async function launch(argv = process.argv.slice(2), dependencies = {}) {
  const { values } = parseArgs(argv);
  const plan = prepareLaunch({
    values,
    baseEnvironment: dependencies.baseEnvironment ?? process.env,
    r2SecretsDirectory: dependencies.r2SecretsDirectory ?? DEFAULT_R2_SECRETS_DIRECTORY,
  });
  return runPreparedLaunch(plan, dependencies);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const result = await launch();
    if (result.code !== 0) {
      process.stderr.write("V2_08_SOULX_LAUNCH_CHILD_FAILED\n");
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = /^V2_08_SOULX_LAUNCH_[A-Z0-9_]+$/u.test(message)
      ? message
      : "V2_08_SOULX_LAUNCH_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

export {
  FD_BINDINGS,
  QUALIFICATION_CLI_PATH,
  QUALIFICATION_CLI_RELATIVE_PATH,
  ROOT,
  TSX_LOADER_PATH,
  TSX_LOADER_RELATIVE_PATH,
  TSX_LOADER_SOURCE_SHA256,
  closePlan,
  ephemeralProductionSecrets,
  exactDirectory,
  exactFile,
  openStableFile,
  parseInputManifest,
  parseProductionSecrets,
  parseRequest,
};

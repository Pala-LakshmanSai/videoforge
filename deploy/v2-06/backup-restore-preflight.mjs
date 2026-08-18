#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { access, chmod, lstat, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = "videoforge-v2-06-backup-restore-preflight/v1";

/**
 * These names are deliberately generic. The bootstrap command creates only empty files; an
 * operator must populate them outside the repository with separately approved values.
 */
export const PRIVATE_INPUTS = Object.freeze([
  Object.freeze({ name: "owner.pg_service.conf", purpose: "PGSERVICEFILE" }),
  Object.freeze({ name: "owner.pgpass", purpose: "PGPASSFILE" }),
  Object.freeze({
    name: "backup.passphrase",
    purpose: "BACKUP_PASSPHRASE_FILE / RESTORE_PASSPHRASE_FILE",
  }),
]);

/**
 * The shell helpers invoke these by bare command name. Checking the resolved PATH entries before
 * a database operation turns a missing Homebrew/libpq setup into a local, provider-free failure.
 */
export const REQUIRED_COMMANDS = Object.freeze([
  "node",
  "sh",
  "pg_dump",
  "pg_restore",
  "psql",
  "openssl",
  "awk",
  "grep",
  "mktemp",
  "dirname",
  "stat",
  "ln",
  "rm",
  "chmod",
  "uname",
]);

export const HASH_COMMANDS = Object.freeze(["shasum", "sha256sum"]);

const COMMANDS_BY_OPERATION = Object.freeze({
  backup: Object.freeze(REQUIRED_COMMANDS),
  restore: Object.freeze(REQUIRED_COMMANDS.filter((command) => command !== "pg_dump")),
  both: Object.freeze(REQUIRED_COMMANDS),
});

const usage = `Usage:
  node deploy/v2-06/backup-restore-preflight.mjs --tools-only [--operation backup|restore|both] [--quiet]
  node deploy/v2-06/backup-restore-preflight.mjs --directory <private-input-dir> [--quiet]
  node deploy/v2-06/backup-restore-preflight.mjs --bootstrap --directory <private-input-dir> [--quiet]

--bootstrap creates only empty mode-0600 placeholders. It never reads, generates, or prints a
credential or passphrase. The bootstrap operation intentionally skips tool checks; run --tools-only
and then the full --directory check after the operator has populated the approved private inputs.`;

const fail = (message) => {
  throw new Error(`V2-06 backup/restore preflight: ${message}`);
};

const mode = (metadata) => metadata.mode & 0o777;

const isMissing = (error) => error?.code === "ENOENT";

const pathEntries = (environment) => {
  const value = environment?.PATH ?? "";
  return value.split(path.delimiter).map((entry) => entry || ".");
};

const candidateNames = (command, environment) => {
  if (process.platform !== "win32" || command.includes(path.sep)) return [command];
  const extensions = (environment?.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`)];
};

/**
 * Resolve a command without executing it. In particular, this does not invoke psql, pg_dump, or
 * any provider client. It only checks PATH metadata and executable permission.
 */
export const resolveExecutable = async (command, environment = process.env) => {
  const candidates = candidateNames(command, environment);
  for (const directory of pathEntries(environment)) {
    for (const name of candidates) {
      const candidate = path.resolve(directory, name);
      try {
        const metadata = await stat(candidate);
        if (!metadata.isFile()) continue;
        await access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        // Continue through PATH without disclosing or trusting a missing entry.
      }
    }
  }
  return null;
};

export const inspectToolchain = async (environment = process.env, operation = "both") => {
  const requiredCommands = COMMANDS_BY_OPERATION[operation];
  if (!requiredCommands) fail(`unsupported operation ${operation}`);
  const commands = {};
  const missing = [];
  for (const command of requiredCommands) {
    const executable = await resolveExecutable(command, environment);
    commands[command] = executable;
    if (!executable) missing.push(command);
  }

  const hashers = {};
  const hashCommands = operation === "restore" ? [] : HASH_COMMANDS;
  for (const command of hashCommands)
    hashers[command] = await resolveExecutable(command, environment);
  const hashCommand = hashCommands.find((command) => hashers[command]) ?? null;
  if (hashCommands.length > 0 && !hashCommand) missing.push("shasum or sha256sum");

  return {
    ready: missing.length === 0,
    operation,
    required_commands: requiredCommands,
    commands,
    hash_commands: hashers,
    selected_hash_command: hashCommand,
    missing,
  };
};

const privateDirectoryMetadata = async (directory) => {
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch (error) {
    if (isMissing(error)) return { exists: false };
    return { exists: false, error: "private input directory is not readable" };
  }
  if (metadata.isSymbolicLink())
    return { exists: true, error: "private input directory is a symlink" };
  if (!metadata.isDirectory())
    return { exists: true, error: "private input path is not a directory" };
  if ((mode(metadata) & 0o077) !== 0)
    return { exists: true, error: "private input directory must not be group/world accessible" };
  return { exists: true, metadata };
};

const inspectFile = async (directory, input) => {
  const file = path.join(directory, input.name);
  let metadata;
  try {
    metadata = await lstat(file);
  } catch (error) {
    if (isMissing(error)) return { name: input.name, purpose: input.purpose, state: "missing" };
    return { name: input.name, purpose: input.purpose, state: "unreadable" };
  }
  if (metadata.isSymbolicLink())
    return { name: input.name, purpose: input.purpose, state: "symlink_rejected" };
  if (!metadata.isFile())
    return { name: input.name, purpose: input.purpose, state: "not_a_regular_file" };
  if (mode(metadata) !== 0o600)
    return { name: input.name, purpose: input.purpose, state: "wrong_mode" };
  return {
    name: input.name,
    purpose: input.purpose,
    state: metadata.size === 0 ? "empty_placeholder" : "populated_without_reading",
  };
};

export const inspectPrivateInputs = async (directoryInput) => {
  if (!directoryInput) fail("private input directory is required");
  const directory = path.resolve(directoryInput);
  const directoryState = await privateDirectoryMetadata(directory);
  if (!directoryState.exists || directoryState.error)
    return {
      directory,
      ready: false,
      error: directoryState.error ?? "private input directory does not exist",
      unexpected_entries: [],
      files: PRIVATE_INPUTS.map(({ name, purpose }) => ({ name, purpose, state: "unavailable" })),
    };

  let entries;
  try {
    entries = await readdir(directory);
  } catch {
    return {
      directory,
      ready: false,
      error: "private input directory cannot be listed",
      unexpected_entries: [],
      files: [],
    };
  }
  const expected = new Set(PRIVATE_INPUTS.map(({ name }) => name));
  const unexpectedEntries = entries.filter((entry) => !expected.has(entry)).sort();
  const files = await Promise.all(PRIVATE_INPUTS.map((input) => inspectFile(directory, input)));
  const ready =
    unexpectedEntries.length === 0 &&
    files.every((file) => file.state === "populated_without_reading");
  return { directory, ready, unexpected_entries: unexpectedEntries, files };
};

const ensurePrivateDirectory = async (directory) => {
  let existed = true;
  try {
    await lstat(directory);
  } catch (error) {
    if (!isMissing(error)) fail("private input directory is not readable");
    existed = false;
  }

  if (!existed) {
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await chmod(directory, 0o700);
    } catch {
      fail("could not create the private input directory");
    }
  }

  const state = await privateDirectoryMetadata(directory);
  if (!state.exists || state.error) fail(state.error ?? "private input directory does not exist");
  if (existed && mode(state.metadata) !== 0o700)
    fail("existing private input directory must have mode 0700 before bootstrap");
  return !existed;
};

/**
 * Create only zero-byte placeholders. Existing populated files are never opened or overwritten;
 * existing files with unsafe type/mode and unexpected directory entries stop the operation.
 */
export const bootstrapPrivateInputs = async (directoryInput) => {
  if (!directoryInput) fail("private input directory is required for --bootstrap");
  const directory = path.resolve(directoryInput);
  const createdDirectory = await ensurePrivateDirectory(directory);
  const before = await inspectPrivateInputs(directory);
  if (before.unexpected_entries.length > 0)
    fail(
      `private input directory contains unexpected entries: ${before.unexpected_entries.join(", ")}`,
    );
  const unsafe = before.files.filter(
    (file) => !["missing", "empty_placeholder", "populated_without_reading"].includes(file.state),
  );
  if (unsafe.length > 0)
    fail(
      `private input files are not safe to preserve: ${unsafe.map(({ name }) => name).join(", ")}`,
    );

  const created = [];
  for (const input of PRIVATE_INPUTS) {
    const file = path.join(directory, input.name);
    const current = before.files.find(({ name }) => name === input.name);
    if (current?.state !== "missing") continue;
    try {
      await writeFile(file, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
      await chmod(file, 0o600);
      created.push(input.name);
    } catch (error) {
      if (error?.code !== "EEXIST") fail(`could not create ${input.name}`);
    }
  }
  const inputs = await inspectPrivateInputs(directory);
  if (inputs.unexpected_entries.length > 0)
    fail(`private input directory changed unexpectedly: ${inputs.unexpected_entries.join(", ")}`);
  const invalid = inputs.files.filter(
    (file) => !["missing", "empty_placeholder", "populated_without_reading"].includes(file.state),
  );
  if (invalid.length > 0)
    fail(
      `private input files changed to unsafe types or modes: ${invalid.map(({ name }) => name).join(", ")}`,
    );
  return { directory, created_directory: createdDirectory, created, inputs };
};

const parseArguments = (argv) => {
  const options = {
    bootstrap: false,
    directory: null,
    operation: "both",
    quiet: false,
    toolsOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--bootstrap") options.bootstrap = true;
    else if (argument === "--tools-only") options.toolsOnly = true;
    else if (argument === "--quiet") options.quiet = true;
    else if (argument === "--operation") {
      options.operation = argv[index + 1];
      index += 1;
      if (!options.operation || !COMMANDS_BY_OPERATION[options.operation])
        fail("--operation must be backup, restore, or both");
    } else if (argument === "--directory") {
      options.directory = argv[index + 1];
      index += 1;
      if (!options.directory || options.directory.startsWith("--"))
        fail("--directory needs a path");
    } else if (argument === "--help" || argument === "-h") options.help = true;
    else fail(`unknown argument ${argument}`);
  }
  if (options.bootstrap && options.toolsOnly)
    fail("--bootstrap and --tools-only are mutually exclusive");
  if (!options.help && options.toolsOnly && options.directory)
    fail("--tools-only cannot take --directory");
  if (!options.help && !options.toolsOnly && !options.directory)
    fail("--directory is required unless --tools-only is used");
  if (!options.help && options.bootstrap && !options.directory)
    fail("--bootstrap requires --directory");
  return options;
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }

  const toolchain = options.bootstrap
    ? { skipped: true }
    : await inspectToolchain(process.env, options.operation);
  const privateInputs = options.toolsOnly
    ? null
    : options.bootstrap
      ? (await bootstrapPrivateInputs(options.directory)).inputs
      : await inspectPrivateInputs(options.directory);
  const ready = options.bootstrap
    ? privateInputs.ready
    : toolchain.ready && (options.toolsOnly || privateInputs.ready);
  const operationSucceeded = options.bootstrap || ready;
  const result = {
    schema_version: SCHEMA_VERSION,
    provider_calls: false,
    remote_mutation: false,
    spend_usd: 0,
    toolchain,
    private_inputs: privateInputs,
    ready,
    operation_succeeded: operationSucceeded,
  };
  if (!options.quiet) console.log(JSON.stringify(result, null, 2));
  if (!operationSucceeded) {
    const missingTools = toolchain.missing?.join(", ");
    const inputError = privateInputs?.error;
    const inputFiles = privateInputs?.files
      ?.filter(({ state }) => state !== "populated_without_reading")
      .map(({ name, state }) => `${name}=${state}`)
      .join(", ");
    const detail = [missingTools && `missing commands: ${missingTools}`, inputError, inputFiles]
      .filter(Boolean)
      .join("; ");
    console.error(`V2-06 backup/restore preflight is not ready${detail ? ` (${detail})` : ""}`);
    process.exitCode = 1;
  }
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export { SCHEMA_VERSION, usage };

#!/usr/bin/env node

import { chmod, lstat, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APPROVED_HOST = "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech";
const APPROVED_PORT = "5432";
const SOURCE_DATABASE = "neondb";
const DISPOSABLE_DATABASE = "videoforge_v2_06_disposable_drill";
const OWNER_ROLE = "neondb_owner";
const SERVICE_NAME = "videoforge_v2_06_disposable_owner";
const SERVICE_FILENAME = "restore.pg_service.conf";
const PASSFILE_NAME = "restore.pgpass";

const fail = (message) => {
  throw new Error(`V2-06 disposable restore inputs: ${message}`);
};

const requirePrivateFile = async (file, label) => {
  let metadata;
  try {
    metadata = await lstat(file);
  } catch {
    fail(`${label} is not readable`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o777) !== 0o600)
    fail(`${label} must be a regular mode-0600 file`);
};

const requirePrivateDirectory = async (directory) => {
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch {
    fail("target directory is not readable");
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || (metadata.mode & 0o777) !== 0o700)
    fail("target directory must be a regular mode-0700 directory");
};

const requireAbsent = async (file, label) => {
  try {
    await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    fail(`${label} cannot be inspected`);
  }
  fail(`${label} already exists; refusing to overwrite`);
};

const prepareDisposableRestoreInputs = async (sourcePassfile, targetDirectory) => {
  if (!sourcePassfile || !targetDirectory)
    fail("source passfile and target directory are required");
  await requirePrivateFile(sourcePassfile, "source PGPASSFILE");
  await requirePrivateDirectory(targetDirectory);

  const sourceBytes = await readFile(sourcePassfile);
  const sourceText = sourceBytes.toString("utf8");
  if (!Buffer.from(sourceText, "utf8").equals(sourceBytes)) fail("source PGPASSFILE is not UTF-8");
  if (!/^[^\r\n]+(?:\r?\n)*$/u.test(sourceText))
    fail("source PGPASSFILE must contain one credential line and only trailing blank lines");
  const sourceLine = sourceText.replace(/(?:\r?\n)+$/u, "");
  const sourcePrefix = `${APPROVED_HOST}:${APPROVED_PORT}:${SOURCE_DATABASE}:${OWNER_ROLE}:`;
  if (!sourceLine.startsWith(sourcePrefix)) fail("source PGPASSFILE identity is not approved");
  const protectedPassword = sourceLine.slice(sourcePrefix.length);
  if (!protectedPassword) fail("source PGPASSFILE password is empty");

  const serviceFile = path.join(targetDirectory, SERVICE_FILENAME);
  const passfile = path.join(targetDirectory, PASSFILE_NAME);
  await requireAbsent(serviceFile, "disposable PGSERVICEFILE");
  await requireAbsent(passfile, "disposable PGPASSFILE");

  const service = `[${SERVICE_NAME}]\nhost=${APPROVED_HOST}\ndbname=${DISPOSABLE_DATABASE}\nuser=${OWNER_ROLE}\nsslmode=require\nchannel_binding=require\n`;
  const disposablePassfile = `${APPROVED_HOST}:${APPROVED_PORT}:${DISPOSABLE_DATABASE}:${OWNER_ROLE}:${protectedPassword}\n`;
  const created = [];
  try {
    await writeFile(serviceFile, service, { encoding: "utf8", flag: "wx", mode: 0o600 });
    created.push(serviceFile);
    await chmod(serviceFile, 0o600);
    await writeFile(passfile, disposablePassfile, { encoding: "utf8", flag: "wx", mode: 0o600 });
    created.push(passfile);
    await chmod(passfile, 0o600);
  } catch (error) {
    await Promise.all(created.map((file) => rm(file, { force: true })));
    throw error;
  }

  return {
    service: SERVICE_NAME,
    service_file: serviceFile,
    passfile,
    host: APPROVED_HOST,
    database: DISPOSABLE_DATABASE,
    owner_role: OWNER_ROLE,
    credential_value_recorded: false,
  };
};

const main = async () => {
  const [sourcePassfile, targetDirectory] = process.argv.slice(2);
  const result = await prepareDisposableRestoreInputs(sourcePassfile, targetDirectory);
  console.log(JSON.stringify(result, null, 2));
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export {
  APPROVED_HOST,
  DISPOSABLE_DATABASE,
  OWNER_ROLE,
  PASSFILE_NAME,
  SERVICE_FILENAME,
  SERVICE_NAME,
  prepareDisposableRestoreInputs,
};

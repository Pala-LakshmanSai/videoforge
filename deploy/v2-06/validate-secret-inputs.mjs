#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { REQUIRED_SECRET_NAMES } from "./secret-policy.mjs";

const [secretDir, activationPath] = process.argv.slice(2);
if (!secretDir || !activationPath)
  throw new Error("secret directory and activation record are required");
const expectedNames = REQUIRED_SECRET_NAMES;
const activationMetadata = await lstat(activationPath);
if (
  activationMetadata.isSymbolicLink() ||
  !activationMetadata.isFile() ||
  (activationMetadata.mode & 0o777) !== 0o600
)
  throw new Error("activation record must be a regular mode-0600 file");
const activation = JSON.parse(await readFile(activationPath, "utf8"));
const directoryMetadata = await lstat(secretDir);
if (
  directoryMetadata.isSymbolicLink() ||
  !directoryMetadata.isDirectory() ||
  (directoryMetadata.mode & 0o077) !== 0
)
  throw new Error("secret directory must be a private directory");
const files = new Map();
for (const name of expectedNames) {
  const file = path.join(secretDir, name);
  const metadata = await lstat(file);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || metadata.size === 0)
    throw new Error(`${name} must be a non-empty regular mode-0600 file`);
  files.set(name, await readFile(file, "utf8"));
}
const entries = await readdir(secretDir);
if (entries.some((name) => !expectedNames.includes(name)))
  throw new Error("secret directory contains an unallowlisted file");

const databaseUrl = new URL(files.get("DATABASE_URL").trim());
if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol))
  throw new Error("DATABASE_URL must use PostgreSQL");
if (
  databaseUrl.hostname !== activation.neon.host ||
  databaseUrl.pathname.slice(1) !== activation.neon.database ||
  decodeURIComponent(databaseUrl.username) !== "videoforge_v2_06_runtime" ||
  databaseUrl.searchParams.get("sslmode") !== "require" ||
  databaseUrl.searchParams.get("channel_binding") !== "require"
)
  throw new Error("DATABASE_URL is not the exact approved runtime Neon identity");

const googleClientId = files.get("GOOGLE_CLIENT_ID").trim();
if (!/^[0-9-]+-[a-z0-9]+\.apps\.googleusercontent\.com$/u.test(googleClientId))
  throw new Error("GOOGLE_CLIENT_ID is malformed");
const expectedGoogleIdHash = activation.google?.oauth_client_id_sha256;
if (`sha256:${createHash("sha256").update(googleClientId).digest("hex")}` !== expectedGoogleIdHash)
  throw new Error("GOOGLE_CLIENT_ID does not match the approved OAuth client fingerprint");

const accessKeyId = files.get("R2_ACCESS_KEY_ID").trim();
if (!/^[A-Za-z0-9]{32}$/u.test(accessKeyId)) throw new Error("R2_ACCESS_KEY_ID is malformed");
if (
  `sha256:${createHash("sha256").update(accessKeyId).digest("hex")}` !==
  activation.cloudflare?.r2_access_key_id_sha256
)
  throw new Error("R2_ACCESS_KEY_ID does not match the approved bucket key fingerprint");
if (!/^[A-Za-z0-9/+=]{64}$/u.test(files.get("R2_SECRET_ACCESS_KEY").trim()))
  throw new Error("R2_SECRET_ACCESS_KEY is malformed");

console.log(
  JSON.stringify({
    database: "approved-runtime-role",
    google_client: "approved-fingerprint",
    r2: "approved-bucket-key-fingerprint",
    count: expectedNames.length,
  }),
);

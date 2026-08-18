#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { REQUIRED_SECRET_NAMES } from "./secret-policy.mjs";

const APPROVED_NEON_HOST = "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech";
const APPROVED_NEON_PROJECT_ID = "ancient-morning-99567618";
const APPROVED_NEON_BRANCH_ID = "br-floral-hill-az7ib4ir";
const APPROVED_NEON_DATABASE = "neondb";
const APPROVED_NEON_RUNTIME_ROLE = "videoforge_v2_06_runtime";
const APPROVED_GOOGLE_PROJECT_ID = "videoforge-v2-06-staging-0817";
const APPROVED_R2_BUCKET = "videoforge-v2-06-staging-private";

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
if (
  activation.schema_version !== "videoforge-v2-06-activation/v1" ||
  activation.checkpoint !== "V2-06" ||
  activation.authority?.mode !== "APPROVED" ||
  activation.authority?.maximum_cumulative_finite_external_spend_usd !== 3 ||
  activation.authority?.cloudflare_r2_recurring_ceiling_usd_per_month !== 2 ||
  activation.authority?.non_transferable !== true ||
  activation.authority?.email_provider !== "NONE" ||
  typeof activation.authority?.approved_at !== "string" ||
  Number.isNaN(Date.parse(activation.authority.approved_at))
)
  throw new Error("activation record is not the exact approved V2-06 authority");
if (
  activation.cloudflare?.worker !== "videoforge-v2-06-staging" ||
  activation.cloudflare?.workflow !== "videoforge-v2-06-staging-video" ||
  activation.cloudflare?.r2_bucket !== APPROVED_R2_BUCKET ||
  activation.cloudflare?.r2_location !== "auto" ||
  activation.neon?.host !== APPROVED_NEON_HOST ||
  activation.neon?.project_id !== APPROVED_NEON_PROJECT_ID ||
  activation.neon?.branch_id !== APPROVED_NEON_BRANCH_ID ||
  activation.neon?.database !== APPROVED_NEON_DATABASE ||
  activation.neon?.runtime_role !== APPROVED_NEON_RUNTIME_ROLE ||
  activation.google?.project_id !== APPROVED_GOOGLE_PROJECT_ID ||
  activation.google?.audience !== "EXTERNAL_TESTING" ||
  typeof activation.google?.oauth_redirect_uri !== "string" ||
  !activation.google.oauth_redirect_uri.startsWith("https://")
)
  throw new Error("activation record does not pin the exact approved V2-06 identities");
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
  const value = await readFile(file, "utf8");
  if (!value.trim() || value.includes("\0"))
    throw new Error(`${name} must contain a non-empty text secret`);
  files.set(name, value);
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
  !databaseUrl.password ||
  databaseUrl.hash ||
  databaseUrl.searchParams.size !== 2 ||
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

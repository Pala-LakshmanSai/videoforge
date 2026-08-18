#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SERVICE_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/u;
const ALLOWED_KEYS = new Set(["host", "port", "dbname", "user", "sslmode", "channel_binding"]);
const REQUIRED_KEYS = ["host", "dbname", "user", "sslmode", "channel_binding"];

const fail = (message) => {
  throw new Error(`V2-06 PostgreSQL service: ${message}`);
};

const requireMode0600 = async (file, label) => {
  let metadata;
  try {
    metadata = await lstat(file);
  } catch {
    fail(`${label} is not readable`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || (metadata.mode & 0o777) !== 0o600)
    fail(`${label} must be a regular mode-0600 file`);
};

const parseService = async (serviceFile, serviceName) => {
  if (!SERVICE_NAME_PATTERN.test(serviceName)) fail("service name is not a simple identifier");
  await requireMode0600(serviceFile, "PGSERVICEFILE");

  const source = await readFile(serviceFile, "utf8");
  const values = new Map();
  let active = false;
  let matchingSections = 0;
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      if (!/^\[[A-Za-z0-9_.-]+\]$/u.test(line)) fail("PGSERVICEFILE contains a malformed section");
      active = line === `[${serviceName}]`;
      if (active) matchingSections += 1;
      if (matchingSections > 1) fail(`PGSERVICEFILE contains duplicate [${serviceName}] sections`);
      continue;
    }
    if (!active) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!match) fail(`service [${serviceName}] contains a malformed setting`);
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (!ALLOWED_KEYS.has(key)) fail(`service [${serviceName}] contains forbidden setting ${key}`);
    if (values.has(key)) fail(`service [${serviceName}] contains duplicate setting ${key}`);
    if (!value) fail(`service [${serviceName}] setting ${key} is empty`);
    values.set(key, value);
  }

  if (matchingSections !== 1)
    fail(`PGSERVICEFILE does not contain exactly one [${serviceName}] section`);
  for (const key of REQUIRED_KEYS) {
    if (!values.has(key)) fail(`service [${serviceName}] must pin ${key}`);
  }
  if (values.get("sslmode") !== "require") fail("PGSERVICEFILE must require TLS (sslmode=require)");
  if (values.get("channel_binding") !== "require")
    fail("PGSERVICEFILE must require channel binding (channel_binding=require)");
  return values;
};

const validateServiceFile = async (
  serviceFile,
  serviceName,
  expectedHost,
  expectedDatabase,
  expectedOwnerRole,
) => {
  if (!expectedHost || !expectedDatabase || !expectedOwnerRole)
    fail("approved host, database, and owner role are required");
  const values = await parseService(serviceFile, serviceName);
  if (values.get("host") !== expectedHost)
    fail("PGSERVICEFILE host does not match the approved Neon endpoint");
  if (values.get("dbname") !== expectedDatabase)
    fail("PGSERVICEFILE dbname does not match the approved Neon database");
  if (values.get("user") !== expectedOwnerRole)
    fail("PGSERVICEFILE user is not the approved migration owner role");
  return values;
};

const main = async () => {
  const [serviceFile, serviceName, expectedHost, expectedDatabase, expectedOwnerRole] =
    process.argv.slice(2);
  if (!serviceFile || !serviceName || !expectedHost || !expectedDatabase || !expectedOwnerRole)
    fail(
      "usage: validate-pg-service.mjs <service-file> <service-name> <host> <database> <owner-role>",
    );
  await validateServiceFile(
    serviceFile,
    serviceName,
    expectedHost,
    expectedDatabase,
    expectedOwnerRole,
  );
  console.log(JSON.stringify({ service: serviceName, tls: "require", channel_binding: "require" }));
};

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();

export { parseService, validateServiceFile };
